const mongoose = require('mongoose');
const MlmMember = require('../models/MlmMember');
const MlmWithdrawal = require('../models/MlmWithdrawal');

function validationError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function validatePayoutDetails(details = {}) {
    if (details.method === 'upi' && /^[\w.-]+@[\w.-]+$/.test(details.upiId || '')) return details;
    if (details.method === 'bank'
        && details.accountName?.trim()
        && details.accountNumber?.trim()
        && /^[A-Z]{4}0[A-Z0-9]{6}$/i.test(details.ifsc || '')) return details;
    throw validationError('Provide valid bank account details or a valid UPI ID.');
}

async function requestWithdrawal({ memberId, amount, payoutDetails }) {
    if (!Number.isSafeInteger(amount) || amount < 500) {
        throw validationError('Withdrawal amount must be a whole rupee amount of at least Rs 500.');
    }
    const details = validatePayoutDetails(payoutDetails);
    const session = await mongoose.startSession();
    let withdrawal;
    try {
        await session.withTransaction(async () => {
            const member = await MlmMember.findOneAndUpdate(
                { _id: memberId, status: 'active', kycStatus: 'approved', walletBalance: { $gte: amount } },
                { $inc: { walletBalance: -amount } },
                { new: true, session },
            );
            if (!member) {
                const currentMember = await MlmMember.findById(memberId).session(session);
                if (currentMember && currentMember.kycStatus !== 'approved') {
                    throw validationError('KYC approval is required before requesting a withdrawal.', 403);
                }
                throw validationError('Member is inactive or wallet balance is insufficient.', 409);
            }
            [withdrawal] = await MlmWithdrawal.create([{
                member: member._id,
                amount,
                payoutDetails: details,
            }], { session });
        });
    } finally {
        await session.endSession();
    }
    return withdrawal;
}

async function reviewWithdrawal({ withdrawalId, adminUserId, decision, paymentReference, rejectionReason }) {
    if (!['paid', 'rejected'].includes(decision)) throw validationError('Decision must be paid or rejected.');
    if (decision === 'rejected' && !rejectionReason?.trim()) {
        throw validationError('A rejection reason is required.');
    }
    if (decision === 'paid' && !paymentReference?.trim()) {
        throw validationError('A transfer reference is required to mark a withdrawal paid.');
    }

    const session = await mongoose.startSession();
    let withdrawal;
    try {
        await session.withTransaction(async () => {
            const current = await MlmWithdrawal.findOneAndUpdate(
                { _id: withdrawalId, status: 'pending' },
                {
                    $set: {
                        status: decision,
                        reviewedBy: adminUserId,
                        reviewedAt: new Date(),
                        paymentReference: decision === 'paid' ? paymentReference.trim() : null,
                        rejectionReason: decision === 'rejected' ? rejectionReason.trim() : null,
                    },
                },
                { new: true, session },
            );
            if (!current) throw validationError('Pending withdrawal not found.', 404);
            if (decision === 'rejected') {
                await MlmMember.updateOne(
                    { _id: current.member },
                    { $inc: { walletBalance: current.amount } },
                    { session },
                );
            }
            withdrawal = current;
        });
    } finally {
        await session.endSession();
    }
    return withdrawal;
}

async function listWithdrawals({ memberId, status, limit = 50 } = {}) {
    const query = {};
    if (memberId) query.member = memberId;
    if (['pending', 'paid', 'rejected'].includes(status)) query.status = status;
    return MlmWithdrawal.find(query)
        .sort({ createdAt: -1 })
        .limit(Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 50)))
        .populate({ path: 'member', select: 'memberCode user', populate: { path: 'user', select: 'name email' } })
        .populate('reviewedBy', 'name email');
}

module.exports = { listWithdrawals, requestWithdrawal, reviewWithdrawal, validatePayoutDetails };