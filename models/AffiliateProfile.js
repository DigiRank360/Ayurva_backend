const mongoose = require('mongoose');

const affiliateProfileSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, immutable: true },
    affiliateId: { type: String, required: true, unique: true, immutable: true },
    referralCode: { type: String, required: true, unique: true, immutable: true },
    status: {
        type: String,
        enum: ['PENDING_PAYMENT', 'PENDING_VERIFICATION', 'ACTIVE', 'REWARD_WINDOW_EXPIRED', 'UNDER_REVIEW', 'SUSPENDED', 'TERMINATED'],
        default: 'PENDING_PAYMENT',
        index: true,
    },
    packageTier: { type: String, enum: ['SILVER', 'GOLD'], default: null },
    activePackage: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliatePackage', default: null },
    activatedAt: { type: Date, default: null },
    phoneVerifiedAt: { type: Date, default: null },
    agreementAcceptedAt: { type: Date, default: null },
    profile: {
        legalName: { type: String, trim: true, maxlength: 120 },
        dateOfBirth: { type: Date },
        address: { type: String, trim: true, maxlength: 500 },
        city: { type: String, trim: true, maxlength: 80 },
        state: { type: String, trim: true, maxlength: 80 },
        postalCode: { type: String, trim: true, maxlength: 12 },
    },
    riskStatus: { type: String, enum: ['PENDING', 'CLEAR', 'REVIEW', 'BLOCKED'], default: 'PENDING' },
    statusReason: { type: String, default: null, maxlength: 500 },
}, { timestamps: true, strict: 'throw' });

affiliateProfileSchema.index({ status: 1, activatedAt: -1 });
affiliateProfileSchema.index({ packageTier: 1, status: 1 });

module.exports = mongoose.model('AffiliateProfile', affiliateProfileSchema);
