const mongoose = require('mongoose');

const affiliateSupportEntitlementSchema = new mongoose.Schema({
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, immutable: true },
    package: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliatePackage', required: true, immutable: true },
    totalSessions: { type: Number, required: true, min: 0 },
    usedSessions: { type: Number, default: 0, min: 0 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    status: { type: String, enum: ['ACTIVE', 'EXHAUSTED', 'EXPIRED', 'REVOKED'], default: 'ACTIVE', index: true },
    ruleSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
}, { timestamps: true, strict: 'throw' });

affiliateSupportEntitlementSchema.index({ order: 1 }, { unique: true });
affiliateSupportEntitlementSchema.index({ customer: 1, status: 1, endsAt: 1 });

module.exports = mongoose.model('AffiliateSupportEntitlement', affiliateSupportEntitlementSchema);
