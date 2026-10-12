const crypto = require('crypto');
const mongoose = require('mongoose');
const MlmCommission = require('../models/MlmCommission');
const MlmMember = require('../models/MlmMember');
const MlmPayoutRun = require('../models/MlmPayoutRun');
const MlmVolumeEvent = require('../models/MlmVolumeEvent');
const { calculateDailyMatching } = require('../utils/binaryMatching');
const { getIndiaDateKey } = require('../utils/mlmDate');

const RUN_LOCK_MS = 10 * 60 * 1000;

async function acquirePayoutRun(dateKey) {
    const now = new Date();
    const lockToken = crypto.randomUUID();
    const lock = { lockToken, lockUntil: new Date(now.getTime() + RUN_LOCK_MS) };
    let run = await MlmPayoutRun.findOne({ dateKey });

    if (!run) {
        try {
            run = await MlmPayoutRun.create({ dateKey, status: 'processing', ...lock, startedAt: now });
            return { run, lockToken, acquired: true };
        } catch (error) {
            if (error.code !== 11000) throw error;
            run = await MlmPayoutRun.findOne({ dateKey });
        }
    }

    if (run.status === 'completed') return { run, acquired: false };
    const mayAcquire = run.status === 'failed' || (run.status === 'processing' && run.lockUntil <= now);
    if (!mayAcquire) return { run, acquired: false };

    const claimedRun = await MlmPayoutRun.findOneAndUpdate(
        { _id: run._id, status: run.status, lockUntil: run.lockUntil },
        { $set: { status: 'processing', ...lock, startedAt: now, error: null } },
        { new: true },
    );
    return { run: claimedRun || run, lockToken, acquired: Boolean(claimedRun) };
}

async function processMemberVolume(memberId, dateKey) {
    const session = await mongoose.startSession();
    let result = { matchedPairs: 0, paidAmount: 0, flushedAmount: 0 };
    try {
        await session.withTransaction(async () => {
            const events = await MlmVolumeEvent.find({
                recipientMember: memberId,
                dateKey,
                processedAt: null,
            }).session(session);
            if (!events.length) return;

            const member = await MlmMember.findOne({ _id: memberId, status: 'active' }).session(session);
            if (!member) {
                await MlmVolumeEvent.updateMany(
                    { _id: { $in: events.map((event) => event._id) }, processedAt: null },
                    { $set: { processedAt: new Date() } },
                    { session },
                );
                return;
            }

            const newLeftMembers = events.filter((event) => event.side === 'left').length;
            const newRightMembers = events.length - newLeftMembers;
            const calculation = calculateDailyMatching({
                packageId: member.packageId,
                leftMembers: member.carriedLeftMembers + newLeftMembers,
                rightMembers: member.carriedRightMembers + newRightMembers,
                firstMatchCompleted: member.firstMatchCompleted,
            });

            member.carriedLeftMembers = calculation.remainingLeftMembers;
            member.carriedRightMembers = calculation.remainingRightMembers;
            member.firstMatchCompleted = calculation.firstMatchCompleted;

            if (calculation.matchedPairs > 0) {
                await MlmCommission.create([{
                    member: member._id,
                    type: 'binary',
                    dateKey,
                    idempotencyKey: `binary:${member._id}:${dateKey}`,
                    matchedPairs: calculation.matchedPairs,
                    grossAmount: calculation.grossIncome,
                    paidAmount: calculation.payableIncome,
                    flushedAmount: calculation.flushedIncome,
                    status: calculation.payableIncome > 0 ? 'paid' : 'flushed',
                }], { session });

                member.walletBalance += calculation.payableIncome;
                member.totalEarnings += calculation.payableIncome;
            }

            await member.save({ session });
            await MlmVolumeEvent.updateMany(
                { _id: { $in: events.map((event) => event._id) }, processedAt: null },
                { $set: { processedAt: new Date() } },
                { session },
            );

            result = {
                matchedPairs: calculation.matchedPairs,
                paidAmount: calculation.payableIncome,
                flushedAmount: calculation.flushedIncome,
            };
        });
    } finally {
        await session.endSession();
    }
    return result;
}

async function runDailyPayouts(dateKey = getIndiaDateKey()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new TypeError('dateKey must use YYYY-MM-DD format.');
    const { run, lockToken, acquired } = await acquirePayoutRun(dateKey);
    if (!acquired) return { dateKey, status: run.status, alreadyProcessed: run.status === 'completed' };

    try {
        const recipients = await MlmVolumeEvent.distinct('recipientMember', { dateKey, processedAt: null });
        for (const recipientId of recipients) {
            await processMemberVolume(recipientId, dateKey);
            const lockRenewal = await MlmPayoutRun.updateOne(
                { _id: run._id, lockToken, status: 'processing' },
                { $set: { lockUntil: new Date(Date.now() + RUN_LOCK_MS) } },
            );
            if (!lockRenewal.modifiedCount) throw new Error('Daily payout lock was lost.');
        }

        const [totals] = await MlmCommission.aggregate([
            { $match: { type: 'binary', dateKey } },
            { $group: {
                _id: null,
                processedMembers: { $sum: 1 },
                matchedPairs: { $sum: '$matchedPairs' },
                totalPaid: { $sum: '$paidAmount' },
                totalFlushed: { $sum: '$flushedAmount' },
            } },
        ]);

        const completedRun = await MlmPayoutRun.findOneAndUpdate(
            { _id: run._id, lockToken, status: 'processing' },
            {
                $set: {
                    status: 'completed',
                    lockToken: null,
                    lockUntil: null,
                    completedAt: new Date(),
                    processedMembers: totals?.processedMembers || 0,
                    matchedPairs: totals?.matchedPairs || 0,
                    totalPaid: totals?.totalPaid || 0,
                    totalFlushed: totals?.totalFlushed || 0,
                },
            },
            { new: true },
        );
        if (!completedRun) throw new Error('Daily payout lock was lost before completion.');
        return completedRun;
    } catch (error) {
        await MlmPayoutRun.updateOne(
            { _id: run._id, lockToken, status: 'processing' },
            { $set: { status: 'failed', error: error.message, lockToken: null, lockUntil: null } },
        );
        throw error;
    }
}

async function runPendingDailyPayouts() {
    const today = getIndiaDateKey();
    const [pendingEventDates, retryableRuns] = await Promise.all([
        MlmVolumeEvent.distinct('dateKey', {
            dateKey: { $lt: today },
            processedAt: null,
        }),
        MlmPayoutRun.find({
            dateKey: { $lt: today },
            $or: [
                { status: 'failed' },
                { status: 'processing', lockUntil: { $lte: new Date() } },
            ],
        }).distinct('dateKey'),
    ]);
    const dateKeys = [...new Set([...pendingEventDates, ...retryableRuns])].sort();
    const runs = [];
    for (const dateKey of dateKeys) runs.push(await runDailyPayouts(dateKey));
    return runs;
}

module.exports = { runDailyPayouts, runPendingDailyPayouts, processMemberVolume };