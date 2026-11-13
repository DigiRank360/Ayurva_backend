const mongoose = require('mongoose');

const affiliateReferralEventSchema = new mongoose.Schema({
    referral: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateReferralLink', required: true, index: true },
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true, index: true },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateCampaign', default: null },
    visitorKey: { type: String, required: true, select: false },
    visitorUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    eventType: { type: String, enum: ['CLICK', 'VIDEO_START', 'VIDEO_25', 'VIDEO_50', 'VIDEO_75', 'VIDEO_COMPLETE', 'REWARD_QUALIFIED'], required: true },
    eventAt: { type: Date, required: true, default: Date.now, immutable: true },
    watchSeconds: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ['RECORDED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'DUPLICATE', 'SELF_REFERRAL', 'CAP_EXCEEDED'], default: 'RECORDED', index: true },
    reasonCode: { type: String, default: null, maxlength: 80 },
    reviewReason: { type: String, default: null, maxlength: 500 },
    dailyKey: { type: String, default: null },
    rewardAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
    videoSessionHash: { type: String, select: false },
}, { timestamps: true, strict: 'throw' });

affiliateReferralEventSchema.index({ affiliate: 1, eventAt: -1 });
affiliateReferralEventSchema.index({ affiliate: 1, visitorKey: 1, eventType: 1, eventAt: -1 });
affiliateReferralEventSchema.index({ affiliate: 1, dailyKey: 1, status: 1 });
affiliateReferralEventSchema.index({ videoSessionHash: 1, eventType: 1 }, { sparse: true, unique: true });

module.exports = mongoose.model('AffiliateReferralEvent', affiliateReferralEventSchema);
