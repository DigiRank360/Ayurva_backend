const mongoose = require('mongoose');

const affiliateReferralLinkSchema = new mongoose.Schema({
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true, index: true },
    token: { type: String, required: true, unique: true, immutable: true },
    kind: { type: String, enum: ['GENERAL', 'VIDEO', 'PACKAGE', 'CAMPAIGN'], required: true },
    package: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliatePackage', default: null },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateCampaign', default: null },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, strict: 'throw' });

affiliateReferralLinkSchema.index({ affiliate: 1, active: 1, createdAt: -1 });
affiliateReferralLinkSchema.index({ campaign: 1, active: 1 });

module.exports = mongoose.model('AffiliateReferralLink', affiliateReferralLinkSchema);
