const crypto = require('crypto');
const AffiliateProfile = require('../models/AffiliateProfile');
const AffiliatePackage = require('../models/AffiliatePackage');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { writeAudit } = require('./affiliateAuditService');
const { assertAffiliateFeatureEnabled } = require('./affiliateConfigService');
const { resolveOrderAttribution } = require('./affiliateReferralService');
const { runInTransaction } = require('./affiliateLedgerService');
const { toMinorUnits } = require('../utils/affiliateMoney');

function orderError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function validateShippingAddress(address) {
    const required = ['name', 'phone', 'address', 'city', 'state', 'postalCode', 'country'];
    if (!address || required.some((key) => typeof address[key] !== 'string' || !address[key].trim())) {
        throw orderError('A complete shipping address is required.');
    }
    if (!/^[+\d][\d\s-]{7,19}$/.test(address.phone)) throw orderError('Enter a valid shipping phone number.');
    return Object.fromEntries(required.map((key) => [key, address[key].trim()]));
}

async function createAffiliatePackageOrder(userId, packageId, shippingAddressInput, idempotencyKey, req) {
    await assertAffiliateFeatureEnabled();
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
        throw orderError('A valid Idempotency-Key header is required.');
    }
    const address = validateShippingAddress(shippingAddressInput);
    const requestHash = crypto.createHash('sha256').update(JSON.stringify({
        packageId: String(packageId),
        address,
        paymentMethod: 'Razorpay',
    })).digest('hex');
    const existing = await Order.findOne({ user: userId, idempotencyKey }).select('+idempotencyHash');
    if (existing) {
        if (existing.purchaseType !== 'AFFILIATE_PACKAGE' || existing.idempotencyHash !== requestHash) {
            throw orderError('Idempotency key was already used with different order details.', 409);
        }
        return existing;
    }
    const [user, affiliatePackage, affiliate] = await Promise.all([
        User.findById(userId),
        AffiliatePackage.findOne({ _id: packageId, active: true, effectiveFrom: { $lte: new Date() }, $or: [{ effectiveTo: null }, { effectiveTo: { $gt: new Date() } }] }),
        AffiliateProfile.findOne({ user: userId }),
    ]);
    if (!user || (user.accountStatus && user.accountStatus !== 'ACTIVE')) throw orderError('Customer account is not active.', 403);
    if (!affiliate) throw orderError('Complete affiliate enrollment before purchasing an affiliate package.', 409);
    if (!affiliatePackage) throw orderError('This affiliate package is not available.', 404);
    if (!affiliatePackage.items.length) throw orderError('This package is not configured with products yet.', 503);
    const packageAmountMinor = toMinorUnits(affiliatePackage.offerPrice);
    const packageItemsMinor = affiliatePackage.items.reduce((total, item) => {
        return total + toMinorUnits(item.unitPriceSnapshot) * item.quantity;
    }, 0);
    if (packageAmountMinor !== packageItemsMinor) {
        throw orderError('Package price and product allocation do not match. Contact support.', 503);
    }

    return runInTransaction(async (session) => {
        const duplicate = await Order.findOne({ user: userId, idempotencyKey }).select('+idempotencyHash').session(session);
        if (duplicate) {
            if (duplicate.purchaseType !== 'AFFILIATE_PACKAGE' || duplicate.idempotencyHash !== requestHash) {
                throw orderError('Idempotency key was already used with different order details.', 409);
            }
            return duplicate;
        }
        const attribution = await resolveOrderAttribution(req, userId, session);
        const orderItems = [];
        for (const item of affiliatePackage.items) {
            const product = await Product.findOneAndUpdate(
                { _id: item.product, isActive: true, stock: { $gte: item.quantity } },
                { $inc: { stock: -item.quantity } },
                { new: true, session },
            );
            if (!product) throw orderError(`A product in this package is unavailable or out of stock.`, 409);
            product.inStock = product.stock > 0;
            await product.save({ session });
            orderItems.push({
                name: item.nameSnapshot,
                qty: item.quantity,
                image: product.images?.[0] || '',
                price: Number(item.unitPriceSnapshot.toString()),
                product: product._id,
            });
        }
        const snapshot = {
            packageId: affiliatePackage._id,
            code: affiliatePackage.code,
            name: affiliatePackage.name,
            version: affiliatePackage.version,
            durationMonths: affiliatePackage.durationMonths,
            mrp: affiliatePackage.mrp.toString(),
            offerPrice: affiliatePackage.offerPrice.toString(),
            videoReward: affiliatePackage.videoReward.toString(),
            dailyReferralCap: affiliatePackage.dailyReferralCap,
            rewardWindowDays: affiliatePackage.rewardWindowDays,
            doctorSessionsPerMonth: affiliatePackage.doctorSessionsPerMonth,
            items: affiliatePackage.items.map((item) => ({
                product: item.product,
                quantity: item.quantity,
                name: item.nameSnapshot,
                unitPrice: item.unitPriceSnapshot.toString(),
            })),
        };
        const [order] = await Order.create([{
            user: userId,
            purchaseType: 'AFFILIATE_PACKAGE',
            affiliatePackage: affiliatePackage._id,
            packageSnapshot: snapshot,
            affiliateAttribution: attribution?._id || null,
            idempotencyKey,
            idempotencyHash: requestHash,
            orderItems,
            shippingAddress: { ...address, type: shippingAddressInput.type || 'Home' },
            itemsPrice: Number(affiliatePackage.offerPrice.toString()),
            taxPrice: 0,
            shippingPrice: 0,
            totalPrice: Number(affiliatePackage.offerPrice.toString()),
            paymentMethod: 'Razorpay',
            paymentStatus: 'Pending',
            orderStatus: 'Pending',
            stockReservationExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        }], { session });
        if (attribution && !attribution.convertedOrder) {
            attribution.convertedOrder = order._id;
            await attribution.save({ session });
        }
        await writeAudit({
            actor: userId,
            action: 'AFFILIATE_PACKAGE_ORDER_CREATED',
            resourceType: 'Order',
            resourceId: order._id,
            after: { packageCode: snapshot.code, packageVersion: snapshot.version, amount: snapshot.offerPrice },
            req,
            session,
        });
        return order;
    });
}

async function createRetailOrderAttribution(req, userId, orderId, session) {
    const attribution = await resolveOrderAttribution(req, userId, session);
    if (!attribution) return null;
    if (attribution.convertedOrder && String(attribution.convertedOrder) !== String(orderId)) return attribution;
    attribution.convertedOrder = orderId;
    await attribution.save({ session });
    return attribution;
}

async function releaseReservedOrderStock(orderId) {
    return runInTransaction(async (session) => {
        const order = await Order.findOneAndUpdate(
            { _id: orderId, stockReleasedAt: null, paymentStatus: { $ne: 'Paid' } },
            { $set: { stockReleasedAt: new Date(), stockReservationExpiresAt: null } },
            { new: true, session },
        );
        if (!order) return null;
        for (const item of order.orderItems) {
            await Product.updateOne(
                { _id: item.product },
                { $inc: { stock: item.qty }, $set: { inStock: true } },
                { session },
            );
        }
        return order;
    });
}

async function consumeOrderStockReservation(orderId, session) {
    return Order.findOneAndUpdate(
        { _id: orderId, stockReleasedAt: null, stockReservationExpiresAt: { $gt: new Date() }, paymentStatus: { $ne: 'Paid' } },
        { $set: { stockReservationExpiresAt: null } },
        { new: true, session },
    );
}

module.exports = {
    consumeOrderStockReservation,
    createAffiliatePackageOrder,
    createRetailOrderAttribution,
    orderError,
    releaseReservedOrderStock,
    validateShippingAddress,
};
