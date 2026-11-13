const mongoose = require('mongoose');
const crypto = require('crypto');
const AffiliateProfile = require('../models/AffiliateProfile');
const Cart = require('../models/Cart');
const Offer = require('../models/Offer');
const OfferRedemption = require('../models/OfferRedemption');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { writeAudit } = require('./affiliateAuditService');
const { runInTransaction } = require('./affiliateLedgerService');
const { fromMinorUnits, percentageOfMinorUnits, toMinorUnits } = require('../utils/affiliateMoney');

const RESERVATION_MINUTES = 30;

function retailOrderError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function validateAddress(address) {
    const required = ['name', 'phone', 'address', 'city', 'state', 'postalCode'];
    if (!address || required.some((key) => typeof address[key] !== 'string' || !address[key].trim())) {
        throw retailOrderError('A complete shipping address is required.');
    }
    if (!/^[+\d][\d\s-]{7,19}$/.test(address.phone)) throw retailOrderError('Enter a valid shipping phone number.');
    return {
        name: address.name.trim(),
        phone: address.phone.trim(),
        address: address.address.trim(),
        city: address.city.trim(),
        state: address.state.trim(),
        postalCode: address.postalCode.trim(),
        country: String(address.country || 'India').trim(),
        type: ['Home', 'Work', 'Other'].includes(address.type) ? address.type : 'Home',
    };
}

function safeNumber(minor) {
    if (!Number.isSafeInteger(minor)) throw retailOrderError('Order amount exceeds the supported range.');
    return Number(fromMinorUnits(minor).toString());
}

async function getOfferDiscount(code, subtotalMinor, session) {
    if (!code) return null;
    const normalizedCode = String(code).trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,40}$/.test(normalizedCode)) throw retailOrderError('Coupon code is invalid.');
    const now = new Date();
    const offer = await Offer.findOne({
        code: normalizedCode,
        isActive: true,
        startDate: { $lte: now },
        endDate: { $gte: now },
        $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }],
    }).session(session);
    if (!offer) throw retailOrderError('Coupon is not available.', 409);
    if (subtotalMinor < toMinorUnits(offer.minOrderAmount || 0)) {
        throw retailOrderError(`Minimum order amount of INR ${offer.minOrderAmount} is required.`, 422);
    }
    let discountMinor;
    if (offer.discountType === 'percentage') {
        discountMinor = percentageOfMinorUnits(subtotalMinor, offer.discountValue);
        if (offer.maxDiscount !== undefined && offer.maxDiscount !== null) {
            discountMinor = Math.min(discountMinor, toMinorUnits(offer.maxDiscount));
        }
    } else {
        discountMinor = toMinorUnits(offer.discountValue);
    }
    return { offer, discountMinor: Math.min(subtotalMinor, discountMinor) };
}

async function reserveOffer({ offer, order, user, discountMinor, expiresAt, session }) {
    if (!offer) return;
    const now = new Date();
    const query = {
        _id: offer._id,
        isActive: true,
        startDate: { $lte: now },
        endDate: { $gte: now },
        $or: [
            { usageLimit: null },
            { $expr: { $lt: ['$usedCount', '$usageLimit'] } },
        ],
    };
    const claimed = await Offer.findOneAndUpdate(query, { $inc: { usedCount: 1 } }, { new: true, session });
    if (!claimed) throw retailOrderError('Coupon usage limit has been reached.', 409);
    await OfferRedemption.create([{
        offer: offer._id,
        order: order._id,
        user,
        code: offer.code,
        discountAmount: safeNumber(discountMinor),
        status: 'RESERVED',
        expiresAt,
    }], { session });
}

async function releaseOfferRedemption(orderId, session) {
    const redemption = await OfferRedemption.findOneAndUpdate(
        { order: orderId, status: 'RESERVED' },
        { $set: { status: 'RELEASED' } },
        { new: true, session },
    );
    if (!redemption) return false;
    const offer = await Offer.findOneAndUpdate(
        { _id: redemption.offer, usedCount: { $gt: 0 } },
        { $inc: { usedCount: -1 } },
        { new: true, session },
    );
    if (!offer) throw retailOrderError('Coupon usage could not be reconciled.', 409);
    return true;
}

async function createRetailOrder(userId, input, idempotencyKey, req) {
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
        throw retailOrderError('A valid Idempotency-Key header is required.');
    }
    const address = validateAddress(input.shippingAddress);
    const paymentMethod = input.paymentMethod === 'Razorpay' ? 'Razorpay' : input.paymentMethod === 'COD' ? 'COD' : null;
    if (!paymentMethod) throw retailOrderError('Payment method must be COD or Razorpay.');
    if (!Array.isArray(input.orderItems) || !input.orderItems.length || input.orderItems.length > 50) {
        throw retailOrderError('The order must contain between 1 and 50 product lines.');
    }
    const quantities = new Map();
    for (const item of input.orderItems) {
        if (!mongoose.isValidObjectId(item.product) || !Number.isSafeInteger(Number(item.qty))
            || Number(item.qty) < 1 || Number(item.qty) > 100) {
            throw retailOrderError('Order product IDs and quantities are invalid.');
        }
        quantities.set(String(item.product), (quantities.get(String(item.product)) || 0) + Number(item.qty));
    }
    if ([...quantities.values()].some((quantity) => quantity > 100)) throw retailOrderError('A product quantity cannot exceed 100.');
    const requestHash = crypto.createHash('sha256').update(JSON.stringify({
        items: [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b)),
        address,
        paymentMethod,
        couponCode: String(input.couponCode || '').trim().toUpperCase(),
    })).digest('hex');

    return runInTransaction(async (session) => {
        const existing = await Order.findOne({ user: userId, idempotencyKey }).select('+idempotencyHash').session(session);
        if (existing) {
            if (existing.purchaseType !== 'RETAIL' || existing.idempotencyHash !== requestHash) {
                throw retailOrderError('Idempotency key was already used with different order details.', 409);
            }
            return { order: existing, created: false };
        }
        const products = await Product.find({
            _id: { $in: [...quantities.keys()] },
            isActive: true,
        }).session(session);
        if (products.length !== quantities.size) throw retailOrderError('One or more products are unavailable.', 409);

        const orderItems = [];
        let subtotalMinor = 0;
        for (const product of products) {
            const quantity = quantities.get(String(product._id));
            const unitMinor = toMinorUnits(product.price);
            const lineMinor = unitMinor * quantity;
            if (!Number.isSafeInteger(lineMinor) || !Number.isSafeInteger(subtotalMinor + lineMinor)) {
                throw retailOrderError('Order amount exceeds the supported range.');
            }
            subtotalMinor += lineMinor;
            const reserved = await Product.findOneAndUpdate(
                { _id: product._id, isActive: true, stock: { $gte: quantity } },
                { $inc: { stock: -quantity } },
                { new: true, session },
            );
            if (!reserved) throw retailOrderError(`Insufficient stock for ${product.name}.`, 409);
            reserved.inStock = reserved.stock > 0;
            await reserved.save({ session });
            orderItems.push({
                name: product.name,
                qty: quantity,
                image: product.images?.[0] || '',
                price: safeNumber(unitMinor),
                product: product._id,
            });
        }

        const coupon = await getOfferDiscount(input.couponCode, subtotalMinor, session);
        const discountMinor = coupon?.discountMinor || 0;
        const taxableMinor = subtotalMinor - discountMinor;
        const taxMinor = Number((BigInt(taxableMinor) * 18n + 50n) / 100n);
        const shippingMinor = 0;
        const totalMinor = taxableMinor + taxMinor + shippingMinor;
        if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
            throw retailOrderError('Calculated order amount is invalid.');
        }
        const expiresAt = paymentMethod === 'Razorpay'
            ? new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000)
            : null;
        const [order] = await Order.create([{
            user: userId,
            purchaseType: 'RETAIL',
            idempotencyKey,
            idempotencyHash: requestHash,
            orderItems,
            shippingAddress: address,
            itemsPrice: safeNumber(subtotalMinor),
            discountPrice: safeNumber(discountMinor),
            offerSnapshot: coupon ? {
                offerId: coupon.offer._id,
                code: coupon.offer.code,
                discountType: coupon.offer.discountType,
                discountValue: coupon.offer.discountValue,
                discountAmount: safeNumber(discountMinor),
            } : null,
            taxPrice: safeNumber(taxMinor),
            shippingPrice: safeNumber(shippingMinor),
            totalPrice: safeNumber(totalMinor),
            paymentMethod,
            paymentStatus: 'Pending',
            orderStatus: 'Pending',
            stockReservationExpiresAt: expiresAt,
        }], { session });
        await reserveOffer({
            offer: coupon?.offer,
            order,
            user: userId,
            discountMinor,
            expiresAt,
            session,
        });
        const attributionService = require('./affiliateOrderService');
        const attribution = await attributionService.createRetailOrderAttribution(req, userId, order._id, session);
        if (attribution) {
            order.affiliateAttribution = attribution._id;
            await order.save({ session });
        }
        const cart = await Cart.findOne({ user: userId }).session(session);
        if (cart) {
            cart.items = [];
            await cart.save({ session });
        }
        await writeAudit({
            actor: userId,
            action: 'RETAIL_ORDER_CREATED',
            resourceType: 'Order',
            resourceId: order._id,
            after: { totalPrice: order.totalPrice, paymentMethod, hasCoupon: Boolean(coupon) },
            req,
            session,
        });
        return { order, created: true };
    });
}

async function cancelOrder({ orderId, userId, isAdmin, reason, req }) {
    return runInTransaction(async (session) => {
        const order = await Order.findById(orderId).session(session);
        if (!order) throw retailOrderError('Order not found.', 404);
        if (!isAdmin && String(order.user) !== String(userId)) throw retailOrderError('Not authorized to cancel this order.', 403);
        if (['Shipped', 'Delivered'].includes(order.orderStatus)) throw retailOrderError('Shipped or delivered orders cannot be cancelled.', 409);
        if (order.paymentStatus === 'Paid' || ['Partially Refunded', 'Refunded'].includes(order.paymentStatus)) {
            throw retailOrderError('Paid orders must be refunded through the payment provider before cancellation.', 409);
        }
        if (order.orderStatus === 'Cancelled') return { order, changed: false };
        const previousStatus = order.orderStatus;
        order.orderStatus = 'Cancelled';
        order.isCancelled = true;
        order.cancelledAt = new Date();
        order.cancellationReason = String(reason || 'Customer requested').slice(0, 500);
        order.stockReservationExpiresAt = null;
        if (!order.stockReleasedAt) {
            for (const item of order.orderItems) {
                await Product.updateOne(
                    { _id: item.product },
                    { $inc: { stock: item.qty }, $set: { inStock: true } },
                    { session },
                );
            }
            order.stockReleasedAt = new Date();
        }
        await releaseOfferRedemption(order._id, session);
        await order.save({ session });
        await writeAudit({
            actor: userId,
            action: 'ORDER_CANCELLED',
            resourceType: 'Order',
            resourceId: order._id,
            before: { orderStatus: previousStatus },
            after: { orderStatus: 'Cancelled' },
            reason: order.cancellationReason,
            req,
            session,
        });
        return { order, changed: true };
    });
}

async function expireOrderReservations() {
    const expired = await Order.find({
        paymentStatus: 'Pending',
        orderStatus: 'Pending',
        stockReleasedAt: null,
        stockReservationExpiresAt: { $lte: new Date() },
    }).select('_id').limit(100).lean();
    for (const { _id } of expired) {
        await runInTransaction(async (session) => {
            const order = await Order.findOneAndUpdate({
                _id,
                paymentStatus: 'Pending',
                orderStatus: 'Pending',
                stockReleasedAt: null,
                stockReservationExpiresAt: { $lte: new Date() },
            }, {
                $set: {
                    orderStatus: 'Cancelled',
                    isCancelled: true,
                    cancelledAt: new Date(),
                    cancellationReason: 'Payment reservation expired.',
                    stockReleasedAt: new Date(),
                    stockReservationExpiresAt: null,
                },
            }, { new: true, session });
            if (!order) return;
            for (const item of order.orderItems) {
                await Product.updateOne({ _id: item.product }, { $inc: { stock: item.qty }, $set: { inStock: true } }, { session });
            }
            await releaseOfferRedemption(order._id, session);
        });
    }
    return expired.length;
}

module.exports = { cancelOrder, createRetailOrder, expireOrderReservations, releaseOfferRedemption };
