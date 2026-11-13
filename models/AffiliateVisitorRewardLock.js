const mongoose = require('mongoose');

const affiliateVisitorRewardLockSchema = new mongoose.Schema({
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true },
    visitorKey: { type: String, required: true, select: false },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateReferralEvent', required: true },
    expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true, strict: 'throw' });

affiliateVisitorRewardLockSchema.index({ affiliate: 1, visitorKey: 1 }, { unique: true });

module.exports = mongoose.model('AffiliateVisitorRewardLock', affiliateVisitorRewardLockSchema);
