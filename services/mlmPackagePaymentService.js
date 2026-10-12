const crypto = require('crypto');
const MlmMember = require('../models/MlmMember');
const MlmPackagePayment = require('../models/MlmPackagePayment');
const { createRazorpayClient, getRazorpayCredentials } = require('../config/razorpay');
const { activateMember } = require('./mlmMemberService');
const { getPackage } = require('./mlmPackageService');

function paymentError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function isValidRazorpaySignature({ orderId, paymentId, signature, secret }) {
    if (![orderId, paymentId, signature, secret].every((value) => typeof value === 'string' && value.length > 0)) return false;
    const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest();
    let supplied;
    try {
        supplied = Buffer.from(signature, 'hex');
    } catch {
        return false;
    }
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function getPackagePaymentConfig() {
    try {
        const { keyId } = getRazorpayCredentials();
        return { enabled: true, keyId };
    } catch {
        return { enabled: false, keyId: null };
    }
}

async function createPackagePaymentOrder(userId) {
    const member = await MlmMember.findOne({ user: userId });
    if (!member) throw paymentError('MLM enrollment not found.', 404);
    if (member.status !== 'pending') throw paymentError('Only pending package enrollments can be paid.', 409);
    const reviewPending = await MlmPackagePayment.findOne({
        member: member._id,
        status: { $in: ['verified', 'approving', 'refund_pending', 'refunding'] },
    });
    if (reviewPending) throw paymentError('Your captured payment is awaiting administrator review. Do not pay again.', 409);

    const client = createRazorpayClient();
    const amount = member.packageSnapshot.discountedPrice * 100;
    const order = await client.orders.create({
        amount,
        currency: 'INR',
        receipt: `mlm_${member._id}_${Date.now()}`,
        notes: { memberId: member._id.toString(), userId: userId.toString(), packageId: member.packageId },
    });

    await MlmPackagePayment.create({
        member: member._id,
        user: userId,
        packageId: member.packageId,
        razorpayOrderId: order.id,
        amount,
        currency: 'INR',
    });

    const { keyId } = getRazorpayCredentials();
    return {
        keyId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        packageId: member.packageId,
        packageName: getPackage(member.packageId).name,
    };
}

async function verifyPackagePayment(userId, { orderId, paymentId, signature }) {
    const { keySecret } = getRazorpayCredentials();
    if (!isValidRazorpaySignature({ orderId, paymentId, signature, secret: keySecret })) {
        throw paymentError('Payment signature is invalid.', 400);
    }

    const paymentRecord = await MlmPackagePayment.findOne({ razorpayOrderId: orderId, user: userId });
    if (!paymentRecord) throw paymentError('Package payment order not found for this account.', 404);
    if (['approved', 'rejected'].includes(paymentRecord.status)) {
        if (paymentRecord.razorpayPaymentId !== paymentId) throw paymentError('This package order was paid with a different payment.', 409);
        return paymentRecord;
    }
    if (paymentRecord.status === 'verified' && paymentRecord.razorpayPaymentId !== paymentId) {
        throw paymentError('A different payment is already being verified for this order.', 409);
    }

    const client = createRazorpayClient();
    const payment = await client.payments.fetch(paymentId);
    if (payment.order_id !== orderId
        || payment.amount !== paymentRecord.amount
        || payment.currency !== paymentRecord.currency
        || payment.status !== 'captured'
        || payment.captured !== true) {
        throw paymentError('Razorpay payment is not captured for the expected package amount.', 400);
    }

    if (paymentRecord.status === 'created') {
        const claimedRecord = await MlmPackagePayment.findOneAndUpdate(
            { _id: paymentRecord._id, status: 'created' },
            { $set: { status: 'verified', razorpayPaymentId: paymentId, signature, verifiedAt: new Date() } },
            { new: true },
        );
        if (!claimedRecord) {
            const currentRecord = await MlmPackagePayment.findById(paymentRecord._id);
            if (currentRecord?.razorpayPaymentId !== paymentId) {
                throw paymentError('A different payment is already being verified for this order.', 409);
            }
        }
    }

    return MlmPackagePayment.findById(paymentRecord._id);
}

async function listPackagePayments(status = 'verified') {
    const filter = ['created', 'verified', 'approving', 'approved', 'refund_pending', 'refunding', 'rejected', 'failed'].includes(status)
        ? { status }
        : {};
    return MlmPackagePayment.find(filter)
        .sort({ createdAt: 1 })
        .limit(100)
        .populate({ path: 'member', select: 'memberCode packageId status', populate: { path: 'user', select: 'name email phone' } })
        .populate('reviewedBy', 'name email');
}

async function getMemberPackagePaymentStatus(userId) {
    const member = await MlmMember.findOne({ user: userId }).select('_id');
    if (!member) throw paymentError('MLM enrollment not found.', 404);
    const payment = await MlmPackagePayment.findOne({ member: member._id }).sort({ createdAt: -1 });
    if (!payment) return { status: 'not_started' };
    return {
        status: payment.status,
        amount: Math.round(payment.amount / 100),
        packageId: payment.packageId,
        reviewedAt: payment.reviewedAt,
        rejectionReason: payment.rejectionReason,
        refundId: payment.refundId,
    };
}

async function reviewPackagePayment({ paymentId, adminUserId, decision, rejectionReason }) {
    if (!['approved', 'rejected'].includes(decision)) throw paymentError('Decision must be approved or rejected.');
    if (decision === 'rejected' && (!rejectionReason || rejectionReason.trim().length < 5)) {
        throw paymentError('Provide a clear reason for rejecting this payment.');
    }

    const existing = await MlmPackagePayment.findById(paymentId);
    if (!existing) throw paymentError('Package payment not found.', 404);
    if (decision === 'approved' && existing.status === 'approved') return existing;
    if (decision === 'rejected' && existing.status === 'rejected') return existing;
    if (decision === 'approved' && !['verified', 'approving'].includes(existing.status)) {
        throw paymentError('Only captured, verified payments can be approved.', 409);
    }
    if (decision === 'rejected' && !['verified', 'refund_pending', 'refunding'].includes(existing.status)) {
        throw paymentError('Only captured, verified payments can be rejected and refunded.', 409);
    }

    const now = new Date();
    const reviewLockToken = crypto.randomUUID();
    const inProgressStatus = decision === 'approved' ? 'approving' : 'refunding';
    const retryStatus = decision === 'approved' ? 'verified' : 'refund_pending';
    const claimed = await MlmPackagePayment.findOneAndUpdate(
        {
            _id: paymentId,
            status: { $in: decision === 'approved' ? ['verified', 'approving'] : ['verified', 'refund_pending', 'refunding'] },
            $or: [
                { reviewLockUntil: null },
                { reviewLockUntil: { $lte: now } },
            ],
        },
        { $set: {
            status: inProgressStatus,
            reviewLockToken,
            reviewLockUntil: new Date(now.getTime() + 2 * 60 * 1000),
            reviewedBy: adminUserId,
            reviewedAt: now,
            rejectionReason: decision === 'rejected' ? rejectionReason.trim() : null,
        } },
        { new: true },
    );
    if (!claimed) throw paymentError('This payment is currently being reviewed. Refresh the queue and try again.', 409);

    try {
        if (decision === 'approved') {
            await activateMember({
                memberId: claimed.member,
                paymentReference: `razorpay:${claimed.razorpayOrderId}:${claimed.razorpayPaymentId}`,
            });
            const approved = await MlmPackagePayment.findOneAndUpdate(
                { _id: claimed._id, reviewLockToken, status: inProgressStatus },
                { $set: { status: 'approved', reviewLockToken: null, reviewLockUntil: null } },
                { new: true },
            );
            if (!approved) throw new Error('Payment review lock was lost during activation.');
            return approved;
        }

        const client = createRazorpayClient();
        const capturedPayment = await client.payments.fetch(claimed.razorpayPaymentId);
        let refundId = claimed.refundId;
        if (capturedPayment.status !== 'refunded' && capturedPayment.amount_refunded < capturedPayment.amount) {
            const refund = await client.payments.refund(claimed.razorpayPaymentId, {
                amount: capturedPayment.amount - capturedPayment.amount_refunded,
                notes: { reason: rejectionReason.trim(), mlmPaymentId: claimed._id.toString() },
            });
            refundId = refund.id;
        }
        const rejected = await MlmPackagePayment.findOneAndUpdate(
            { _id: claimed._id, reviewLockToken, status: inProgressStatus },
            { $set: { status: 'rejected', refundId, reviewLockToken: null, reviewLockUntil: null } },
            { new: true },
        );
        if (!rejected) throw new Error('Payment review lock was lost during refund.');
        return rejected;
    } catch (error) {
        await MlmPackagePayment.updateOne(
            { _id: claimed._id, reviewLockToken, status: inProgressStatus },
            { $set: { status: retryStatus, reviewLockToken: null, reviewLockUntil: null } },
        );
        if (error.statusCode) throw error;
        throw paymentError(`Payment review could not be completed: ${error.message}`, 502);
    }
}

module.exports = {
    createPackagePaymentOrder,
    getPackagePaymentConfig,
    getMemberPackagePaymentStatus,
    isValidRazorpaySignature,
    listPackagePayments,
    reviewPackagePayment,
    verifyPackagePayment,
};