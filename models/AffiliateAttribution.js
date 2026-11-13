const mongoose = require('mongoose');

const affiliateAttributionSchema = new mongoose.Schema({
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true, index: true },
    referral: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateReferralLink', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    firstTouchAt: { type: Date, required: true },
    lastTouchAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    policyVersion: { type: String, required: true },
    status: { type: String, enum: ['ACTIVE', 'CONVERTED', 'EXPIRED', 'INVALIDATED'], default: 'ACTIVE', index: true },
    convertedOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    convertedAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });

affiliateAttributionSchema.index({ customer: 1, status: 1, expiresAt: -1 });
affiliateAttributionSchema.index(
    { convertedOrder: 1 },
    { unique: true, partialFilterExpression: { convertedOrder: { $type: 'objectId' } } },
);
affiliateAttributionSchema.index(
    { customer: 1 },
    { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
);

module.exports = mongoose.model('AffiliateAttribution', affiliateAttributionSchema);
