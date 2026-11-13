const mongoose = require('mongoose');
const AffiliateWalletAccount = require('../models/AffiliateWalletAccount');
const AffiliateWalletEntry = require('../models/AffiliateWalletEntry');
const { fromMinorUnits, toMinorUnits } = require('../utils/affiliateMoney');

function ledgerError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

async function serializeAffiliateWallet(affiliateId, session) {
    await AffiliateWalletAccount.findOneAndUpdate(
        { affiliate: affiliateId },
        { $inc: { sequence: 1 }, $set: { updatedAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true, session },
    );
}

async function getWalletSummary(affiliateId, session) {
    let query = AffiliateWalletEntry.aggregate([
        { $match: { affiliate: new mongoose.Types.ObjectId(affiliateId) } },
        {
            $group: {
                _id: '$bucket',
                credits: { $sum: { $cond: [{ $eq: ['$direction', 'CREDIT'] }, '$amount', mongoose.Types.Decimal128.fromString('0')] } },
                debits: { $sum: { $cond: [{ $eq: ['$direction', 'DEBIT'] }, '$amount', mongoose.Types.Decimal128.fromString('0')] } },
            },
        },
    ]);
    if (session) query = query.session(session);
    const rows = await query;
    const totals = {};
    for (const row of rows) {
        totals[row._id] = toMinorUnits(row.credits) - toMinorUnits(row.debits);
    }
    return {
        pending: totals.PENDING || 0,
        approved: totals.APPROVED || 0,
        available: totals.AVAILABLE || 0,
        onHold: totals.ON_HOLD || 0,
        reserved: totals.RESERVED || 0,
        paidLifetime: totals.PAID || 0,
        reversed: totals.REVERSED || 0,
        currency: 'INR',
    };
}

async function postEntry({ affiliate, idempotencyKey, sourceType, sourceId, bucket, direction, amountMinor, description, relatedEntry, createdBy, session }) {
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw ledgerError('Ledger amount must be a positive minor-unit integer.');
    return AffiliateWalletEntry.create([{
        affiliate,
        idempotencyKey,
        sourceType,
        sourceId,
        bucket,
        direction,
        amount: fromMinorUnits(amountMinor),
        currency: 'INR',
        description,
        relatedEntry: relatedEntry || null,
        createdBy: createdBy || null,
        effectiveAt: new Date(),
    }], { session }).then(([entry]) => entry);
}

async function transferFunds({ affiliate, sourceType, sourceId, fromBucket, toBucket, amountMinor, idempotencyKey, description, createdBy, session }) {
    await serializeAffiliateWallet(affiliate, session);
    const debitKey = `${idempotencyKey}:debit`;
    const creditKey = `${idempotencyKey}:credit`;
    const [existingDebit, existingCredit] = await Promise.all([
        AffiliateWalletEntry.findOne({ idempotencyKey: debitKey }).session(session),
        AffiliateWalletEntry.findOne({ idempotencyKey: creditKey }).session(session),
    ]);
    if (existingDebit && existingCredit) return { debit: existingDebit, credit: existingCredit, duplicate: true };
    if (existingDebit || existingCredit) throw ledgerError('Ledger transfer is incomplete and requires reconciliation.', 409);

    const summary = await getWalletSummary(affiliate, session);
    const availableByBucket = {
        PENDING: summary.pending,
        APPROVED: summary.approved,
        AVAILABLE: summary.available,
        ON_HOLD: summary.onHold,
        RESERVED: summary.reserved,
        PAID: summary.paidLifetime,
        REVERSED: summary.reversed,
    };
    if ((availableByBucket[fromBucket] || 0) < amountMinor) {
        throw ledgerError(`Insufficient ${fromBucket.toLowerCase()} balance.`);
    }

    const debit = await postEntry({
        affiliate, idempotencyKey: debitKey, sourceType, sourceId, bucket: fromBucket,
        direction: 'DEBIT', amountMinor, description, createdBy, session,
    });
    const credit = await postEntry({
        affiliate, idempotencyKey: creditKey, sourceType, sourceId, bucket: toBucket,
        direction: 'CREDIT', amountMinor, description, relatedEntry: debit._id, createdBy, session,
    });
    return { debit, credit, duplicate: false };
}

async function runInTransaction(callback) {
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await callback(session);
        });
        return result;
    } catch (error) {
        if (error.code === 20 || /Transaction numbers are only allowed|replica set/i.test(error.message || '')) {
            throw ledgerError('Affiliate financial operations require a MongoDB replica set or transaction-capable cluster.', 503);
        }
        throw error;
    } finally {
        await session.endSession();
    }
}

module.exports = {
    getWalletSummary,
    postEntry,
    runInTransaction,
    serializeAffiliateWallet,
    transferFunds,
};
