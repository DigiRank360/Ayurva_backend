const crypto = require('crypto');
const AffiliateOrderSettlement = require('../models/AffiliateOrderSettlement');
const AffiliateCommission = require('../models/AffiliateCommission');
const Payment = require('../models/Payment');
const Order = require('../models/Order');
const { createRazorpayClient, getRazorpayCredentials } = require('../config/razorpay');
const { runInTransaction } = require('./affiliateLedgerService');
const { processPaidAffiliateOrder } = require('./affiliateSettlementService');
const { writeAudit } = require('./affiliateAuditService');
const { toMinorUnits } = require('../utils/affiliateMoney');
const OfferRedemption = require('../models/OfferRedemption');
const AffiliateWebhookEvent = require('../models/AffiliateWebhookEvent');
const PaymentRefundEvent = require('../models/PaymentRefundEvent');
const PaymentRefundRequest = require('../models/PaymentRefundRequest');
const ReturnRequest = require('../models/Return');

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
    return supplied.length === expected.length && crypto.timingSafeEqual(expected, supplied);
}

async function createPaymentOrder(userId, orderId) {
    if (!orderId) throw paymentError('Order ID is required.');
    const order = await Order.findOne({ _id: orderId, user: userId });
    if (!order) throw paymentError('Order not found for this account.', 404);
    if (order.paymentMethod !== 'Razorpay') throw paymentError('This order is not configured for online payment.', 409);
    if (order.paymentStatus === 'Paid' || order.orderStatus === 'Cancelled') throw paymentError('This order cannot accept another payment.', 409);
    if (order.stockReleasedAt || (order.stockReservationExpiresAt && order.stockReservationExpiresAt <= new Date())) {
        throw paymentError('The order reservation has expired. Create a new order.', 409);
    }

    const existing = await Payment.findOne({
        orderId: order._id,
        user: userId,
        status: 'Created',
        razorpayOrderId: { $type: 'string' },
    }).sort({ createdAt: -1 });
    if (existing) {
        const { keyId } = getRazorpayCredentials();
        return {
            keyId,
            orderId: existing.razorpayOrderId,
            amount: existing.amount,
            currency: existing.currency,
        };
    }

    const credentials = getRazorpayCredentials();
    const lockToken = crypto.randomUUID();
    const lockedOrder = await Order.findOneAndUpdate({
        _id: order._id,
        user: userId,
        paymentStatus: { $ne: 'Paid' },
        $or: [{ paymentAttemptLockUntil: null }, { paymentAttemptLockUntil: { $lte: new Date() } }],
    }, {
        $set: {
            paymentAttemptLockToken: lockToken,
            paymentAttemptLockUntil: new Date(Date.now() + 2 * 60 * 1000),
        },
    }, { new: true }).select('+paymentAttemptLockToken');
    if (!lockedOrder) throw paymentError('A payment order is already being created for this purchase.', 409);

    try {
        const amount = toMinorUnits(lockedOrder.totalPrice);
        if (!Number.isSafeInteger(amount) || amount <= 0) throw paymentError('Order amount is invalid.', 409);
        const gatewayOrder = await createRazorpayClient().orders.create({
            amount,
            currency: 'INR',
            receipt: `ayv_${lockedOrder._id.toString().slice(-20)}`,
            notes: { orderId: lockedOrder._id.toString(), userId: userId.toString() },
        });
        if (gatewayOrder.amount !== amount || gatewayOrder.currency !== 'INR') {
            throw paymentError('Payment provider returned an unexpected amount or currency.', 502);
        }
        await Payment.create({
            razorpayOrderId: gatewayOrder.id,
            orderId: lockedOrder._id,
            user: userId,
            amount,
            currency: 'INR',
            status: 'Created',
        });
        await Order.updateOne(
            { _id: lockedOrder._id, paymentAttemptLockToken: lockToken },
            { $set: { paymentAttemptLockToken: null, paymentAttemptLockUntil: null } },
        );
        return { keyId: credentials.keyId, orderId: gatewayOrder.id, amount, currency: 'INR' };
    } catch (error) {
        await Order.updateOne(
            { _id: lockedOrder._id, paymentAttemptLockToken: lockToken },
            { $set: { paymentAttemptLockToken: null, paymentAttemptLockUntil: null } },
        );
        throw error;
    }
}

async function markPaymentCaptured({ razorpayOrderId, razorpayPaymentId, signature = null, providerEventId = null, userId = null }) {
    const payment = await Payment.findOne({ razorpayOrderId }).select('+razorpaySignature');
    if (!payment || (userId && String(payment.user) !== String(userId))) {
        throw paymentError('Payment order was not found for this account.', 404);
    }
    if (payment.razorpayPaymentId && payment.razorpayPaymentId !== razorpayPaymentId) {
        throw paymentError('This payment order was already captured by another payment.', 409);
    }
    const order = await Order.findById(payment.orderId);
    if (!order) throw paymentError('Order associated with payment was not found.', 404);
    if (String(order.user) !== String(payment.user || userId)) throw paymentError('Payment customer does not match the order customer.', 409);
    if (order.paymentMethod !== 'Razorpay') throw paymentError('Order payment method does not match the provider.', 409);
    if (toMinorUnits(order.totalPrice) !== payment.amount || payment.currency !== 'INR') {
        throw paymentError('Payment amount or currency does not match the stored order.', 409);
    }
    if (order.paymentStatus === 'Paid') {
        if (order.paymentResult?.razorpayPaymentId !== razorpayPaymentId) {
            throw paymentError('Order was already paid with a different provider payment.', 409);
        }
        return { order, payment, duplicate: true };
    }
    if (['Cancelled', 'Delivered'].includes(order.orderStatus)) {
        throw paymentError('The order is no longer eligible for payment.', 409);
    }

    const result = await runInTransaction(async (session) => {
        const currentPayment = await Payment.findById(payment._id).session(session);
        const currentOrder = await Order.findById(order._id).session(session);
        if (!currentPayment || !currentOrder) throw paymentError('Payment or order was removed.', 404);
        if (currentPayment.razorpayPaymentId && currentPayment.razorpayPaymentId !== razorpayPaymentId) {
            throw paymentError('Payment order was captured with a different payment.', 409);
        }
        if (currentOrder.paymentStatus === 'Paid') {
            if (currentOrder.paymentResult?.razorpayPaymentId !== razorpayPaymentId) {
                throw paymentError('Order was already paid with a different provider payment.', 409);
            }
            if (['Cancelled', 'Delivered'].includes(currentOrder.orderStatus)
                || currentOrder.stockReleasedAt
                || (currentOrder.stockReservationExpiresAt && currentOrder.stockReservationExpiresAt <= new Date())) {
                throw paymentError('The order reservation has expired or the order is no longer eligible for payment.', 409);
            }
            return { order: currentOrder, payment: currentPayment, duplicate: true };
        }
        currentPayment.razorpayPaymentId = razorpayPaymentId;
        currentPayment.razorpaySignature = signature;
        currentPayment.status = 'Captured';
        currentPayment.verifiedAt = new Date();
        currentPayment.capturedAt = new Date();
        currentPayment.providerEventId = providerEventId;
        await currentPayment.save({ session });

        currentOrder.paymentStatus = 'Paid';
        currentOrder.paymentResult = {
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature: signature || undefined,
            paidAt: new Date(),
        };
        if (currentOrder.orderStatus === 'Pending') currentOrder.orderStatus = 'Processing';
        currentOrder.stockReservationExpiresAt = null;
        await currentOrder.save({ session });
        await OfferRedemption.updateOne(
            { order: currentOrder._id, status: 'RESERVED' },
            { $set: { status: 'REDEEMED', expiresAt: null } },
            { session },
        );

        if (currentOrder.purchaseType === 'AFFILIATE_PACKAGE') {
            await AffiliateOrderSettlement.findOneAndUpdate(
                { order: currentOrder._id },
                { $setOnInsert: { order: currentOrder._id, status: 'PENDING', attempts: 0 } },
                { upsert: true, new: true, setDefaultsOnInsert: true, session },
            );
        }
        return { order: currentOrder, payment: currentPayment, duplicate: false };
    });

    if (result.order.purchaseType === 'AFFILIATE_PACKAGE') {
        await processAffiliateOrderSettlement(result.order._id, userId);
        result.settlement = await AffiliateOrderSettlement.findOne({ order: result.order._id }).lean();
    } else {
        result.settlement = null;
    }
    return result;
}

async function verifyPaymentForOrder(userId, { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature }, expectedOrderId = null) {
    if (!orderId || !paymentId || !signature) throw paymentError('Payment verification details are incomplete.');
    const { keySecret } = getRazorpayCredentials();
    if (!isValidRazorpaySignature({ orderId, paymentId, signature, secret: keySecret })) {
        throw paymentError('Payment signature is invalid.', 400);
    }
    const record = await Payment.findOne({ razorpayOrderId: orderId, user: userId });
    if (!record) throw paymentError('Payment order not found for this account.', 404);
    if (expectedOrderId && String(record.orderId) !== String(expectedOrderId)) {
        throw paymentError('Payment does not belong to the requested order.', 409);
    }
    const providerPayment = await createRazorpayClient().payments.fetch(paymentId);
    if (providerPayment.order_id !== orderId
        || providerPayment.amount !== record.amount
        || providerPayment.currency !== record.currency
        || providerPayment.status !== 'captured'
        || providerPayment.captured !== true) {
        throw paymentError('Provider has not confirmed capture for the expected order, amount and currency.', 409);
    }
    const result = await markPaymentCaptured({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        signature,
        userId,
    });
    return { status: 'success', message: 'Payment captured and verified.', ...result };
}

async function processAffiliateOrderSettlement(orderId, actor = null, req = null) {
    let settlement = await AffiliateOrderSettlement.findOneAndUpdate(
        {
            order: orderId,
            status: { $in: ['PENDING', 'BLOCKED', 'FAILED', 'PROCESSING'] },
            $or: [{ lockUntil: null }, { lockUntil: { $lte: new Date() } }],
        },
        {
            $set: { status: 'PROCESSING', lockUntil: new Date(Date.now() + 2 * 60 * 1000), lastAttemptAt: new Date() },
            $inc: { attempts: 1 },
        },
        { new: true },
    );
    if (!settlement) {
        return AffiliateOrderSettlement.findOne({ order: orderId }).lean();
    }
    try {
        await runInTransaction(async (session) => {
            const order = await Order.findById(orderId).session(session);
            if (!order || order.paymentStatus !== 'Paid') throw paymentError('Affiliate settlement requires a paid order.', 409);
            await processPaidAffiliateOrder(orderId, session, actor, req);
            await AffiliateOrderSettlement.updateOne(
                { _id: settlement._id },
                { $set: { status: 'COMPLETED', completedAt: new Date(), lockUntil: null, lastErrorCode: null } },
                { session },
            );
        });
        return AffiliateOrderSettlement.findById(settlement._id).lean();
    } catch (error) {
        const blocked = error.statusCode === 503;
        await AffiliateOrderSettlement.updateOne(
            { _id: settlement._id },
            { $set: { status: blocked ? 'BLOCKED' : 'FAILED', lockUntil: null, lastErrorCode: String(error.message).slice(0, 120) } },
        );
        console.error('AFFILIATE_ORDER_SETTLEMENT_FAILED:', {
            orderId: String(orderId),
            status: blocked ? 'BLOCKED' : 'FAILED',
            message: error.message,
        });
        return AffiliateOrderSettlement.findById(settlement._id).lean();
    }
}

async function handleVerifiedRazorpayWebhookEvent(event) {
    const paymentEntity = event.payload?.payment?.entity;
    const refundEntity = event.payload?.refund?.entity;
    if (event.event === 'payment.captured') {
        if (!paymentEntity || paymentEntity.status !== 'captured' || paymentEntity.captured !== true) {
            throw paymentError('Webhook payment event is not a captured payment.', 400);
        }
        const linkedPayment = await Payment.findOne({ razorpayOrderId: paymentEntity.order_id });
        if (!linkedPayment
            || paymentEntity.amount !== linkedPayment.amount
            || paymentEntity.currency !== linkedPayment.currency) {
            throw paymentError('Webhook capture amount or currency does not match the stored payment order.', 409);
        }
        const result = await markPaymentCaptured({
            razorpayOrderId: paymentEntity.order_id,
            razorpayPaymentId: paymentEntity.id,
            providerEventId: event.id,
        });
        return { order: result.order, payment: result.payment };
    }
    if (event.event === 'payment.failed') {
        if (!paymentEntity?.order_id) throw paymentError('Payment failure webhook is missing the provider order ID.', 400);
        const payment = await Payment.findOne({ razorpayOrderId: paymentEntity.order_id, status: 'Created' });
        if (payment) {
            payment.status = 'Failed';
            payment.failureCode = paymentEntity.error_code || 'PAYMENT_FAILED';
            await payment.save();
        }
        return { acknowledged: true };
    }
    if (event.event === 'refund.failed') {
        if (!refundEntity?.id) throw paymentError('Failed-refund webhook is missing the provider refund ID.', 400);
        const request = await PaymentRefundRequest.findOne({ providerRefundId: refundEntity.id });
        if (request && request.status !== 'COMPLETED') {
            request.status = 'FAILED';
            request.failureReason = String(refundEntity.error_reason || 'Provider reported refund failure.').slice(0, 300);
            await request.save();
            await ReturnRequest.updateOne(
                { _id: request.returnRequest },
                { $set: { refundStatus: 'Failed' } },
            );
        }
        return { acknowledged: true };
    }
    if (event.event === 'refund.processed') {
        if (!refundEntity?.payment_id) throw paymentError('Refund webhook is missing the payment ID.', 400);
        const payment = await Payment.findOne({ razorpayPaymentId: refundEntity.payment_id });
        if (!payment) throw paymentError('Refund webhook payment is not linked yet.', 409);
        return runInTransaction(async (session) => {
            const currentPayment = await Payment.findById(payment._id).session(session);
            const order = await Order.findById(payment.orderId).session(session);
            if (!currentPayment || !order) throw paymentError('Refund payment/order association is missing.', 409);
            const refundAmountMinor = Number(refundEntity.amount);
            const providerEventId = String(event.id || '');
            if (!providerEventId) throw paymentError('Refund webhook is missing its provider event ID.', 400);
            if (!Number.isSafeInteger(refundAmountMinor) || refundAmountMinor <= 0
                    || currentPayment.refundedAmountMinor + refundAmountMinor > currentPayment.amount) {
                throw paymentError('Refund amount is invalid or exceeds the remaining captured amount.', 409);
            }
            const existingRefund = await PaymentRefundEvent.findOne({ providerEventId }).session(session);
            if (existingRefund) {
                if (String(existingRefund.payment) !== String(currentPayment._id)
                    || existingRefund.amountMinor !== refundAmountMinor) {
                    throw paymentError('Provider event ID was reused with different refund details.', 409);
                }
                return { acknowledged: true, duplicate: true };
            }
            await PaymentRefundEvent.create([{
                providerEventId,
                payment: currentPayment._id,
                order: order._id,
                amountMinor: refundAmountMinor,
                occurredAt: refundEntity.created_at ? new Date(refundEntity.created_at * 1000) : new Date(),
            }], { session });
            const refundRequest = await PaymentRefundRequest.findOne({ providerRefundId: refundEntity.id }).session(session);
            if (refundRequest) {
                if (refundRequest.amountMinor !== refundAmountMinor) {
                    throw paymentError('Provider refund amount does not match the authorized return refund.', 409);
                }
                refundRequest.status = 'COMPLETED';
                refundRequest.completedAt = new Date();
                await refundRequest.save({ session });
                await ReturnRequest.updateOne(
                    { _id: refundRequest.returnRequest },
                    { $set: { refundStatus: 'Completed', refundedAt: new Date() } },
                    { session },
                );
            }
            const totalRefundedMinor = currentPayment.refundedAmountMinor + refundAmountMinor;
            const fullRefund = totalRefundedMinor === currentPayment.amount;
            if (order.purchaseType === 'AFFILIATE_PACKAGE') {
                await reverseAffiliateCommission({
                    order,
                    providerEventId: event.id,
                    refundAmountMinor,
                    cumulativeRefundMinor: totalRefundedMinor,
                    fullRefund,
                    occurredAt: refundEntity.created_at ? new Date(refundEntity.created_at * 1000) : new Date(),
                    session,
                });
            }
            currentPayment.refundedAmountMinor = totalRefundedMinor;
            currentPayment.status = fullRefund ? 'Refunded' : 'Captured';
            currentPayment.providerEventId = event.id;
            await currentPayment.save({ session });
            order.paymentStatus = fullRefund ? 'Refunded' : 'Partially Refunded';
            await order.save({ session });
            return { acknowledged: true, fullRefund };
        });
    }
    return { acknowledged: true, ignored: true };
}

async function initiateReturnRefund({ returnId, actor, req }) {
    const returnRequest = await ReturnRequest.findById(returnId);
    if (!returnRequest) throw paymentError('Return request not found.', 404);
    if (returnRequest.returnType !== 'Return' || returnRequest.returnStatus !== 'Completed') {
        throw paymentError('Only completed product returns can be refunded.', 409);
    }
    const priorRequest = await PaymentRefundRequest.findOne({ returnRequest: returnId });
    if (priorRequest) {
        if (priorRequest.status === 'FAILED' || priorRequest.status === 'REQUESTED') {
            throw paymentError('Refund request requires provider reconciliation; it will not be submitted a second time.', 409);
        }
        return priorRequest;
    }

    const order = await Order.findById(returnRequest.order);
    if (!order || order.paymentMethod !== 'Razorpay' || order.paymentStatus !== 'Paid') {
        throw paymentError('Only Razorpay-paid orders are eligible for provider refunds.', 409);
    }
    const returnedQuantities = new Map(returnRequest.returnItems.map((item) => [String(item.product), item.quantity]));
    const orderedQuantities = new Map(order.orderItems.map((item) => [String(item.product), item.qty]));
    if (returnedQuantities.size !== orderedQuantities.size
        || [...orderedQuantities].some(([product, quantity]) => returnedQuantities.get(product) !== quantity)) {
        throw paymentError('Partial product refunds are disabled until the refund allocation policy is approved.', 409);
    }
    const payment = await Payment.findOne({ orderId: order._id, status: 'Captured' });
    if (!payment || payment.refundedAmountMinor !== 0 || payment.amount !== toMinorUnits(order.totalPrice)) {
        throw paymentError('Captured payment is missing, already refunded, or inconsistent with the order.', 409);
    }
    const [request] = await PaymentRefundRequest.create([{
        returnRequest: returnRequest._id,
        payment: payment._id,
        order: order._id,
        amountMinor: payment.amount,
        requestedBy: actor,
        status: 'REQUESTED',
    }]);

    try {
        const refund = await createRazorpayClient().payments.refund(payment.razorpayPaymentId, {
            amount: request.amountMinor,
            notes: { orderId: String(order._id), returnId: String(returnRequest._id) },
        });
        if (!refund?.id || refund.amount !== request.amountMinor || refund.payment_id !== payment.razorpayPaymentId) {
            throw paymentError('Payment provider returned inconsistent refund details.', 502);
        }
        request.providerRefundId = refund.id;
        request.status = 'PROCESSING';
        await request.save();
        returnRequest.refundStatus = 'Processing';
        returnRequest.refundProviderId = refund.id;
        await returnRequest.save();
        await writeAudit({
            actor,
            action: 'ORDER_REFUND_REQUESTED',
            resourceType: 'Return',
            resourceId: returnRequest._id,
            after: { refundRequest: request._id, amountMinor: request.amountMinor, status: request.status },
            req,
        });
        return request;
    } catch (error) {
        request.status = 'FAILED';
        request.failureReason = String(error.message).slice(0, 300);
        await request.save();
        await ReturnRequest.updateOne({ _id: returnRequest._id }, { $set: { refundStatus: 'Failed' } });
        throw error;
    }
}

async function handleWebhookDelivery({ event, payloadHash }) {
    if (!event?.id || !event?.event) throw paymentError('Razorpay webhook is missing its event ID or type.', 400);
    let delivery = await AffiliateWebhookEvent.findOne({ provider: 'RAZORPAY', sourceEventId: event.id });
    if (!delivery) {
        try {
            delivery = await AffiliateWebhookEvent.create({
                provider: 'RAZORPAY',
                sourceEventId: event.id,
                eventType: event.event,
                payloadHash,
            });
        } catch (error) {
            if (error.code !== 11000) throw error;
            delivery = await AffiliateWebhookEvent.findOne({ provider: 'RAZORPAY', sourceEventId: event.id });
        }
    }
    if (!delivery) throw paymentError('Webhook delivery could not be recorded.', 503);
    if (delivery.payloadHash !== payloadHash || delivery.eventType !== event.event) {
        throw paymentError('Razorpay event ID was reused with different payload content.', 409);
    }
    if (delivery.status === 'PROCESSED') return { acknowledged: true, duplicate: true };

    const now = new Date();
    const claimed = await AffiliateWebhookEvent.findOneAndUpdate({
        _id: delivery._id,
        status: { $in: ['RECEIVED', 'FAILED', 'PROCESSING'] },
        $or: [{ lockUntil: null }, { lockUntil: { $lte: now } }],
    }, {
        $set: { status: 'PROCESSING', lockUntil: new Date(now.getTime() + 2 * 60 * 1000), processingError: null },
    }, { new: true });
    if (!claimed) return { acknowledged: true, processing: true };

    try {
        const result = await handleVerifiedRazorpayWebhookEvent(event);
        await AffiliateWebhookEvent.updateOne(
            { _id: claimed._id, status: 'PROCESSING' },
            { $set: { status: 'PROCESSED', processedAt: new Date(), lockUntil: null, processingError: null } },
        );
        return result;
    } catch (error) {
        await AffiliateWebhookEvent.updateOne(
            { _id: claimed._id, status: 'PROCESSING' },
            { $set: { status: 'FAILED', lockUntil: null, processingError: String(error.message).slice(0, 300) } },
        );
        throw error;
    }
}

async function reverseAffiliateCommission({ order, providerEventId, refundAmountMinor, cumulativeRefundMinor, fullRefund, occurredAt, session }) {
    if (!session) {
        return runInTransaction((transaction) => reverseAffiliateCommission({
            order, providerEventId, refundAmountMinor, cumulativeRefundMinor, fullRefund, occurredAt, session: transaction,
        }));
    }
    const commission = await AffiliateCommission.findOne({ order: order._id }).session(session);
    if (!commission) return null;
    const Adjustment = require('../models/AffiliateCommissionAdjustment');
    const existing = await Adjustment.findOne({ providerEventId }).session(session);
    if (existing) return existing;
    const config = await require('./affiliateConfigService').getActiveConfig(session);
    const originalCommissionMinor = require('../utils/affiliateMoney').toMinorUnits(commission.commissionAmount);
    const priorAdjustments = await Adjustment.find({ commission: commission._id, status: 'POSTED' }).session(session);
    const alreadyAdjustedMinor = priorAdjustments.reduce((sum, item) => sum + require('../utils/affiliateMoney').toMinorUnits(item.amount), 0);
    if (!fullRefund && config?.partialRefundMode !== 'PRO_RATA') {
        const previous = commission.status;
        if (commission.status !== 'ON_HOLD') {
            const fromBucket = previous === 'PENDING' ? 'PENDING'
                : previous === 'APPROVED' ? 'APPROVED'
                    : previous === 'PAYABLE' ? 'AVAILABLE' : null;
            if (fromBucket) {
                await require('./affiliateLedgerService').transferFunds({
                    affiliate: commission.affiliate,
                    sourceType: 'HOLD',
                    sourceId: commission._id,
                    fromBucket,
                    toBucket: 'ON_HOLD',
                    amountMinor: Math.max(0, originalCommissionMinor - alreadyAdjustedMinor),
                    idempotencyKey: `commission:${commission._id}:refund-policy-hold`,
                    description: 'Commission held while partial-refund policy is pending.',
                    session,
                });
            }
            commission.status = 'ON_HOLD';
            commission.statusReason = 'Partial refund awaits finance-approved adjustment policy.';
            await commission.save({ session });
        }
        await writeAudit({
            action: 'COMMISSION_PARTIAL_REFUND_HELD',
            resourceType: 'AffiliateCommission',
            resourceId: commission._id,
            reason: 'Partial refund formula is not configured.',
            after: { providerEventId },
            session,
        });
        return { held: true };
    }
    const originalOrderMinor = order.packageSnapshot?.offerPrice
        ? require('../utils/affiliateMoney').toMinorUnits(order.packageSnapshot.offerPrice)
        : Math.round(Number(order.totalPrice) * 100);
    const targetAdjustedMinor = fullRefund
        ? originalCommissionMinor
        : Number((BigInt(originalCommissionMinor) * BigInt(cumulativeRefundMinor) + BigInt(originalOrderMinor) / 2n) / BigInt(originalOrderMinor));
    const commissionAdjustmentMinor = Math.min(originalCommissionMinor - alreadyAdjustedMinor, targetAdjustedMinor - alreadyAdjustedMinor);
    if (!Number.isSafeInteger(commissionAdjustmentMinor) || commissionAdjustmentMinor <= 0) return null;
    await require('./affiliateLedgerService').serializeAffiliateWallet(commission.affiliate, session);
    const [adjustment] = await Adjustment.create([{
        commission: commission._id,
        affiliate: commission.affiliate,
        order: order._id,
        providerEventId,
        type: fullRefund ? 'FULL_REFUND' : 'PARTIAL_REFUND',
        amount: require('../utils/affiliateMoney').fromMinorUnits(commissionAdjustmentMinor),
        currency: 'INR',
        status: 'POSTED',
        ruleSnapshot: { partialRefundMode: config?.partialRefundMode || null },
        occurredAt,
    }], { session });
    const bucket = commission.status === 'PENDING' ? 'PENDING'
        : commission.status === 'APPROVED' ? 'APPROVED'
            : commission.status === 'PAID' ? 'PAID'
                : commission.status === 'ON_HOLD' ? 'ON_HOLD' : 'AVAILABLE';
    await require('./affiliateLedgerService').transferFunds({
            affiliate: commission.affiliate,
            sourceType: 'REVERSAL',
            sourceId: adjustment._id,
            fromBucket: bucket,
            toBucket: 'REVERSED',
            amountMinor: commissionAdjustmentMinor,
            idempotencyKey: `refund:${providerEventId}:commission`,
            description: fullRefund ? 'Commission reversed after verified full refund.' : 'Commission adjusted after verified partial refund.',
            session,
        });
    commission.adjustmentAmount = require('../utils/affiliateMoney').fromMinorUnits(alreadyAdjustedMinor + commissionAdjustmentMinor);
    if (alreadyAdjustedMinor + commissionAdjustmentMinor >= originalCommissionMinor) commission.status = 'REVERSED';
    await commission.save({ session });
    return adjustment;
}

module.exports = {
    createPaymentOrder,
    handleWebhookDelivery,
    initiateReturnRefund,
    handleVerifiedRazorpayWebhookEvent,
    isValidRazorpaySignature,
    markPaymentCaptured,
    processAffiliateOrderSettlement,
    reverseAffiliateCommission,
    verifyPaymentForOrder,
};
