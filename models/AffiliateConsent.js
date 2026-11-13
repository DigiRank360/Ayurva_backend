const mongoose = require('mongoose');

const affiliateConsentSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true, immutable: true },
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', default: null, immutable: true },
    purpose: { type: String, enum: ['AFFILIATE_AGREEMENT', 'TERMS', 'PRIVACY', 'REFERRAL_TRACKING', 'DOCTOR_SUPPORT', 'PAYOUT_KYC', 'MARKETING'], required: true, immutable: true },
    version: { type: String, required: true, maxlength: 80, immutable: true },
    granted: { type: Boolean, required: true, immutable: true },
    occurredAt: { type: Date, required: true, default: Date.now, immutable: true },
    source: { type: String, enum: ['WEB', 'ADMIN', 'API'], required: true, immutable: true },
    ipHash: { type: String, default: null, select: false, immutable: true },
}, { timestamps: true, strict: 'throw' });

affiliateConsentSchema.index({ user: 1, purpose: 1, occurredAt: -1 });
affiliateConsentSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function rejectMutation() {
    throw new Error('Consent history is append-only; record a new consent event.');
});

module.exports = mongoose.model('AffiliateConsent', affiliateConsentSchema);
