const crypto = require('crypto');
const AffiliateProfile = require('../models/AffiliateProfile');
const AffiliateKyc = require('../models/AffiliateKyc');
const AffiliatePayoutMethod = require('../models/AffiliatePayoutMethod');
const AffiliatePayoutRequest = require('../models/AffiliatePayoutRequest');
const AffiliatePayoutTransaction = require('../models/AffiliatePayoutTransaction');
const { encryptKycData, hashKycIdentifier } = require('../utils/kycEncryption');
const { fromMinorUnits, toMinorUnits } = require('../utils/affiliateMoney');
const { writeAudit } = require('./affiliateAuditService');
const { assertAffiliateFeatureEnabled } = require('./affiliateConfigService');
const { getWalletSummary, runInTransaction, serializeAffiliateWallet, transferFunds } = require('./affiliateLedgerService');

function payoutError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function validatePayoutDestination(input) {
    if (input.method === 'UPI') {
        const upiId = String(input.upiId || '').trim();
        if (!/^[a-zA-Z0-9._-]{2,100}@[a-zA-Z0-9.-]{2,64}$/.test(upiId)) {
            throw payoutError('Enter a valid UPI ID.');
        }
        return { method: 'UPI', destination: upiId, lastFour: upiId.slice(-4), holderName: String(input.holderName || '').trim() };
    }
    if (input.method === 'BANK') {
        const accountNumber = String(input.accountNumber || '').trim();
        const ifsc = String(input.ifsc || '').trim().toUpperCase();
        if (!/^\d{9,18}$/.test(accountNumber) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
            throw payoutError('Enter valid bank account and IFSC details.');
        }
        return {
            method: 'BANK',
            destination: accountNumber,
            lastFour: accountNumber.slice(-4),
            holderName: String(input.holderName || '').trim(),
            ifsc,
        };
    }
    throw payoutError('Payout method must be BANK or UPI.');
}

async function setPayoutMethod(userId, input, req) {
    await assertAffiliateFeatureEnabled();
    const affiliate = await AffiliateProfile.findOne({ user: userId });
    if (!affiliate) throw payoutError('Affiliate profile not found.', 404);
    if (!input.holderName?.trim()) throw payoutError('Account holder name is required.');
    const pending = await AffiliatePayoutRequest.exists({
        affiliate: affiliate._id,
        status: { $in: ['REQUESTED', 'APPROVED', 'PROCESSING'] },
    });
    if (pending) throw payoutError('Payout destination cannot change while a payout is in progress.', 409);

    const destination = validatePayoutDestination(input);
    const encrypted = encryptKycData(Buffer.from(destination.destination, 'utf8'));
    const record = await AffiliatePayoutMethod.findOneAndUpdate(
        { affiliate: affiliate._id },
        {
            $set: {
                method: destination.method,
                holderName: destination.holderName,
                accountNumberEncrypted: destination.method === 'BANK' ? encrypted.encrypted : null,
                accountNumberIv: destination.method === 'BANK' ? encrypted.iv : null,
                accountNumberAuthTag: destination.method === 'BANK' ? encrypted.authTag : null,
                upiIdEncrypted: destination.method === 'UPI' ? encrypted.encrypted : null,
                upiIdIv: destination.method === 'UPI' ? encrypted.iv : null,
                upiIdAuthTag: destination.method === 'UPI' ? encrypted.authTag : null,
                ifsc: destination.ifsc || null,
                destinationLastFour: destination.lastFour,
                destinationHash: hashKycIdentifier(`${destination.method}:${destination.destination}:${destination.ifsc || ''}`),
                status: 'PENDING',
                reviewedBy: null,
                reviewedAt: null,
                rejectionReason: null,
                createdBy: userId,
            },
            $setOnInsert: { affiliate: affiliate._id },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    ).select('method holderName ifsc destinationLastFour status reviewedAt');
    await writeAudit({
        actor: userId,
        action: 'AFFILIATE_PAYOUT_METHOD_SUBMITTED',
        resourceType: 'AffiliatePayoutMethod',
        resourceId: record._id,
        after: { method: record.method, destinationLastFour: record.destinationLastFour, status: record.status },
        req,
    });
    return record;
}

async function getPayoutMethod(userId) {
    const affiliate = await AffiliateProfile.findOne({ user: userId }).select('_id');
    if (!affiliate) throw payoutError('Affiliate profile not found.', 404);
    return AffiliatePayoutMethod.findOne({ affiliate: affiliate._id })
        .select('method holderName ifsc destinationLastFour status reviewedAt rejectionReason')
        .lean();
}

async function requestPayout(userId, amount, idempotencyKey, req) {
    const config = await assertAffiliateFeatureEnabled();
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(String(idempotencyKey || ''))) {
        throw payoutError('A valid Idempotency-Key header is required.');
    }
    const amountMinor = toMinorUnits(amount);
    const minimumMinor = toMinorUnits(config.payoutMinimum);
    if (amountMinor < minimumMinor) throw payoutError(`Minimum payout amount is ${config.payoutCurrency} ${config.payoutMinimum.toString()}.`, 422);
    const affiliate = await AffiliateProfile.findOne({ user: userId, status: 'ACTIVE' });
    if (!affiliate) throw payoutError('Only active affiliates can request payouts.', 403);
    if (config.requiresKycForPayout) {
        const latestKyc = await AffiliateKyc.findOne({ affiliate: affiliate._id }).sort({ version: -1 }).select('status');
        if (latestKyc?.status !== 'APPROVED') throw payoutError('Approved KYC is required before requesting a payout.', 403);
    }
    const method = await AffiliatePayoutMethod.findOne({ affiliate: affiliate._id, status: 'VERIFIED' });
    if (!method) throw payoutError('Add and verify a bank or UPI payout method first.', 409);

    return runInTransaction(async (session) => {
        await serializeAffiliateWallet(affiliate._id, session);
        const existing = await AffiliatePayoutRequest.findOne({ idempotencyKey }).session(session);
        if (existing) {
            if (String(existing.affiliate) !== String(affiliate._id)) throw payoutError('Idempotency key is already in use.', 409);
            if (toMinorUnits(existing.amount) !== amountMinor || String(existing.method) !== String(method._id)) {
                throw payoutError('Idempotency key was already used with different payout details.', 409);
            }
            return existing;
        }
        const summary = await getWalletSummary(affiliate._id, session);
        if (summary.available < amountMinor) throw payoutError('Available wallet balance is insufficient.', 409);
        const [request] = await AffiliatePayoutRequest.create([{
            affiliate: affiliate._id,
            idempotencyKey,
            method: method._id,
            methodSnapshot: {
                method: method.method,
                holderName: method.holderName,
                destinationLastFour: method.destinationLastFour,
                ifsc: method.ifsc,
            },
            amount: fromMinorUnits(amountMinor),
            currency: config.payoutCurrency,
            status: 'REQUESTED',
        }], { session });
        await transferFunds({
            affiliate: affiliate._id,
            sourceType: 'PAYOUT_RESERVATION',
            sourceId: request._id,
            fromBucket: 'AVAILABLE',
            toBucket: 'RESERVED',
            amountMinor,
            idempotencyKey: `payout:${request._id}:reserve`,
            description: 'Payout amount reserved.',
            createdBy: userId,
            session,
        });
        await AffiliatePayoutTransaction.create([{
            payoutRequest: request._id,
            idempotencyKey: `payout:${request._id}:requested`,
            eventType: 'REQUESTED',
            amount: request.amount,
            providerReference: null,
            reason: 'Payout request submitted.',
            actor: userId,
        }], { session });
        await writeAudit({
            actor: userId,
            action: 'AFFILIATE_PAYOUT_REQUESTED',
            resourceType: 'AffiliatePayoutRequest',
            resourceId: request._id,
            after: { amount: request.amount.toString(), status: request.status },
            req,
            session,
        });
        return request;
    });
}

async function reviewPayout({ payoutId, decision, reason, actor, req }) {
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw payoutError('Decision must be APPROVED or REJECTED.');
    if (decision === 'REJECTED' && (!reason || reason.trim().length < 5)) {
        throw payoutError('Provide a mandatory rejection reason.');
    }
    const config = await assertAffiliateFeatureEnabled();
    return runInTransaction(async (session) => {
        const payout = await AffiliatePayoutRequest.findById(payoutId).session(session);
        if (!payout || payout.status !== 'REQUESTED') throw payoutError('Payout request was not found or was already reviewed.', 409);
        const affiliate = await AffiliateProfile.findById(payout.affiliate).session(session);
        if (config.requiresMakerChecker && String(affiliate.user) === String(actor)) {
            throw payoutError('The payout requester cannot review their own request.', 403);
        }
        const previous = payout.status;
        payout.status = decision;
        payout.reviewedBy = actor;
        payout.reviewedAt = new Date();
        payout.rejectionReason = decision === 'REJECTED' ? reason.trim() : null;
        await payout.save({ session });
        const amountMinor = toMinorUnits(payout.amount);
        if (decision === 'REJECTED') {
            await transferFunds({
                affiliate: payout.affiliate,
                sourceType: 'PAYOUT_RELEASE',
                sourceId: payout._id,
                fromBucket: 'RESERVED',
                toBucket: 'AVAILABLE',
                amountMinor,
                idempotencyKey: `payout:${payout._id}:reject-release`,
                description: 'Rejected payout reservation released.',
                createdBy: actor,
                session,
            });
        }
        await AffiliatePayoutTransaction.create([{
            payoutRequest: payout._id,
            idempotencyKey: `payout:${payout._id}:${decision.toLowerCase()}`,
            eventType: decision,
            amount: payout.amount,
            reason: decision === 'REJECTED' ? reason.trim() : null,
            actor,
        }], { session });
        await writeAudit({
            actor,
            action: `AFFILIATE_PAYOUT_${decision}`,
            resourceType: 'AffiliatePayoutRequest',
            resourceId: payout._id,
            reason,
            before: { status: previous },
            after: { status: decision },
            req,
            session,
        });
        return payout;
    });
}

async function markPayoutProcessing({ payoutId, actor, req }) {
    const config = await assertAffiliateFeatureEnabled();
    return runInTransaction(async (session) => {
        const payout = await AffiliatePayoutRequest.findById(payoutId).session(session);
        if (!payout || payout.status !== 'APPROVED') throw payoutError('Only approved payouts can be processed.', 409);
        if (config.requiresMakerChecker && payout.reviewedBy && String(payout.reviewedBy) === String(actor)) {
            throw payoutError('The payout reviewer cannot process the same payout.', 403);
        }
        payout.status = 'PROCESSING';
        payout.executedBy = actor;
        payout.executedAt = new Date();
        await payout.save({ session });
        await AffiliatePayoutTransaction.create([{
            payoutRequest: payout._id,
            idempotencyKey: `payout:${payout._id}:processing`,
            eventType: 'PROCESSING',
            amount: payout.amount,
            actor,
        }], { session });
        await writeAudit({
            actor,
            action: 'AFFILIATE_PAYOUT_PROCESSING',
            resourceType: 'AffiliatePayoutRequest',
            resourceId: payout._id,
            after: { status: payout.status },
            req,
            session,
        });
        return payout;
    });
}

async function settlePayout({ payoutId, decision, providerReference, reason, actor, req }) {
    if (!['PAID', 'FAILED'].includes(decision)) throw payoutError('Decision must be PAID or FAILED.');
    if (decision === 'PAID' && (!providerReference || !/^[A-Za-z0-9._/-]{4,120}$/.test(providerReference))) {
        throw payoutError('A valid bank UTR or provider reference is required before marking paid.');
    }
    if (decision === 'FAILED' && (!reason || reason.trim().length < 5)) {
        throw payoutError('Provide a clear reason for payout failure.');
    }
    const config = await assertAffiliateFeatureEnabled();
    return runInTransaction(async (session) => {
        const payout = await AffiliatePayoutRequest.findById(payoutId).session(session);
        if (!payout || payout.status !== 'PROCESSING') throw payoutError('Only processing payouts can be settled.', 409);
        if (config.requiresMakerChecker && (
            String(payout.executedBy || '') === String(actor)
            || String(payout.reviewedBy || '') === String(actor)
        )) {
            throw payoutError('Payout confirmation requires an independent finance operator.', 403);
        }
        const amountMinor = toMinorUnits(payout.amount);
        await transferFunds({
            affiliate: payout.affiliate,
            sourceType: decision === 'PAID' ? 'PAYOUT_SETTLEMENT' : 'PAYOUT_RELEASE',
            sourceId: payout._id,
            fromBucket: 'RESERVED',
            toBucket: decision === 'PAID' ? 'PAID' : 'AVAILABLE',
            amountMinor,
            idempotencyKey: `payout:${payout._id}:${decision.toLowerCase()}`,
            description: decision === 'PAID' ? 'Payout confirmed and reconciled.' : 'Failed payout reservation released.',
            createdBy: actor,
            session,
        });
        const previous = payout.status;
        payout.status = decision;
        payout.failureReason = decision === 'FAILED' ? reason.trim() : null;
        if (decision === 'PAID') {
            payout.executedAt = new Date();
        }
        await payout.save({ session });
        await AffiliatePayoutTransaction.create([{
            payoutRequest: payout._id,
            idempotencyKey: `payout:${payout._id}:${decision.toLowerCase()}:transaction`,
            eventType: decision,
            amount: payout.amount,
            providerReference: decision === 'PAID' ? providerReference.trim() : null,
            reason: decision === 'FAILED' ? reason.trim() : null,
            actor,
        }], { session });
        await writeAudit({
            actor,
            action: `AFFILIATE_PAYOUT_${decision}`,
            resourceType: 'AffiliatePayoutRequest',
            resourceId: payout._id,
            reason,
            before: { status: previous },
            after: { status: decision, providerReference: decision === 'PAID' ? providerReference.trim() : null },
            req,
            session,
        });
        return payout;
    });
}

async function reviewPayoutMethod({ methodId, decision, reason, actor, req }) {
    const config = await assertAffiliateFeatureEnabled();
    if (!['VERIFIED', 'REJECTED'].includes(decision)) throw payoutError('Decision must be VERIFIED or REJECTED.');
    if (decision === 'REJECTED' && (!reason || reason.trim().length < 5)) throw payoutError('Provide a rejection reason.');
    const method = await AffiliatePayoutMethod.findOne({ _id: methodId, status: 'PENDING' });
    if (!method) throw payoutError('Payout method was not found or already reviewed.', 404);
    if (config.requiresMakerChecker && String(method.createdBy) === String(actor)) {
        throw payoutError('The payout method submitter cannot verify their own destination.', 403);
    }
    method.status = decision;
    method.reviewedBy = actor;
    method.reviewedAt = new Date();
    method.rejectionReason = decision === 'REJECTED' ? reason.trim() : null;
    await method.save();
    await writeAudit({
        actor,
        action: `AFFILIATE_PAYOUT_METHOD_${decision}`,
        resourceType: 'AffiliatePayoutMethod',
        resourceId: method._id,
        reason,
        after: { status: decision, destinationLastFour: method.destinationLastFour },
        req,
    });
    return method;
}

async function listPayouts(userId, filter = {}) {
    const affiliate = await AffiliateProfile.findOne({ user: userId }).select('_id');
    if (!affiliate) throw payoutError('Affiliate profile not found.', 404);
    const query = { affiliate: affiliate._id };
    if (filter.status) query.status = filter.status;
    return AffiliatePayoutRequest.find(query).sort({ createdAt: -1 }).limit(100).populate('method', 'method holderName ifsc destinationLastFour').lean();
}

module.exports = {
    getPayoutMethod,
    listPayouts,
    markPayoutProcessing,
    requestPayout,
    reviewPayout,
    reviewPayoutMethod,
    setPayoutMethod,
    settlePayout,
    validatePayoutDestination,
};
