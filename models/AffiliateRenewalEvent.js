const mongoose = require('mongoose');

const affiliateRenewalEventSchema = new mongoose.Schema({
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true, index: true, immutable: true },
    qualifyingOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, immutable: true },
    previousWindow: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateRewardWindow', default: null, immutable: true },
    newWindow: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateRewardWindow', required: true, immutable: true },
    status: { type: String, enum: ['APPLIED', 'REVERSED'], default: 'APPLIED' },
    appliedAt: { type: Date, required: true, default: Date.now, immutable: true },
    reversedAt: { type: Date, default: null },
    reason: { type: String, default: null, maxlength: 500 },
}, { timestamps: true, strict: 'throw' });

affiliateRenewalEventSchema.index({ qualifyingOrder: 1 }, { unique: true });
affiliateRenewalEventSchema.index({ affiliate: 1, appliedAt: -1 });

module.exports = mongoose.model('AffiliateRenewalEvent', affiliateRenewalEventSchema);
