const mongoose = require('mongoose');

const affiliateProgramConfigSchema = new mongoose.Schema({
    version: { type: Number, required: true, min: 1, unique: true },
    status: { type: String, enum: ['DRAFT', 'ACTIVE', 'RETIRED'], default: 'DRAFT' },
    featureEnabled: { type: Boolean, default: false },
    attributionWindowDays: { type: Number, default: null, min: 1, max: 365 },
    attributionMode: { type: String, enum: ['FIRST_CLICK', 'LAST_CLICK', 'LOCKED', null], default: null },
    visitorUniquenessDays: { type: Number, default: null, min: 1, max: 365 },
    watchThresholdSeconds: { type: Number, default: null, min: 1, max: 86400 },
    dailyCapMode: { type: String, enum: ['RESERVE_ON_RECEIPT', 'COUNT_ON_APPROVAL'], default: null },
    renewalMode: { type: String, enum: ['EXTEND_ACTIVE', 'RESTART_EXPIRED'], default: null },
    qualifyingRenewalTier: { type: String, enum: ['ANY', 'SAME_TIER', null], default: null },
    rewardWindowStartConvention: { type: String, enum: ['ACTIVATION_INSTANT', 'IST_DAY_START', null], default: null },
    commissionBasePolicy: { type: String, enum: ['NET_COLLECTED', 'OFFER_PRICE', 'CUSTOM', null], default: null },
    partialRefundMode: { type: String, enum: ['PRO_RATA', 'FULL_REVERSAL_ONLY', null], default: null },
    payoutMinimum: { type: mongoose.Schema.Types.Decimal128, default: null },
    payoutCurrency: { type: String, default: 'INR', maxlength: 3 },
    requiresKycForPayout: { type: Boolean, default: true },
    requiresMakerChecker: { type: Boolean, default: true },
    selfReferralPolicy: { type: String, enum: ['REJECT_OWN_ACCOUNT', 'HOLD_RISK', null], default: null },
    affiliateAgreementVersion: { type: String, default: null, maxlength: 80 },
    termsVersion: { type: String, default: null, maxlength: 80 },
    privacyVersion: { type: String, default: null, maxlength: 80 },
    supportConsentVersion: { type: String, default: null, maxlength: 80 },
    referralConsentVersion: { type: String, default: null, maxlength: 80 },
    kycConsentVersion: { type: String, default: null, maxlength: 80 },
    legalApprovalReferences: { type: [String], default: [] },
    changeReason: { type: String, required: true, maxlength: 500 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    activatedAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });

affiliateProgramConfigSchema.index({ status: 1, activatedAt: -1 });
affiliateProgramConfigSchema.index(
    { status: 1 },
    { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
);

module.exports = mongoose.model('AffiliateProgramConfig', affiliateProgramConfigSchema);
