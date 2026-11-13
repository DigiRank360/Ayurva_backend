const mongoose = require('mongoose');

const affiliateCommissionRuleSchema = new mongoose.Schema({
    packageCode: { type: String, enum: ['SILVER', 'GOLD'], required: true },
    version: { type: Number, required: true, min: 1 },
    active: { type: Boolean, default: false, index: true },
    ratePercent: { type: mongoose.Schema.Types.Decimal128, required: true },
    commissionBase: { type: String, enum: ['NET_COLLECTED', 'OFFER_PRICE', 'CUSTOM'], required: true },
    effectiveFrom: { type: Date, required: true, default: Date.now },
    effectiveTo: { type: Date, default: null },
    settlementDays: { type: Number, required: true, min: 0, max: 365 },
    changeReason: { type: String, required: true, maxlength: 500 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, strict: 'throw' });

affiliateCommissionRuleSchema.index({ packageCode:  1, version: 1 }, { unique: true });
affiliateCommissionRuleSchema.index({ active: 1, packageCode: 1, effectiveFrom: -1 });
affiliateCommissionRuleSchema.index(
    { packageCode: 1 },
    { unique: true, partialFilterExpression: { active: true } },
);

module.exports = mongoose.model('AffiliateCommissionRule', affiliateCommissionRuleSchema);
