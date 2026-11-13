const mongoose = require('mongoose');

const affiliateWalletEntrySchema = new mongoose.Schema({
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true, immutable: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true, immutable: true },
    sourceType: { type: String, enum: ['VIDEO_REWARD', 'COMMISSION', 'APPROVAL', 'REVERSAL', 'HOLD', 'RELEASE', 'PAYOUT_RESERVATION', 'PAYOUT_RELEASE', 'PAYOUT_SETTLEMENT', 'ADJUSTMENT'], required: true, immutable: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    bucket: { type: String, enum: ['PENDING', 'APPROVED', 'AVAILABLE', 'ON_HOLD', 'RESERVED', 'PAID', 'REVERSED'], required: true, immutable: true },
    direction: { type: String, enum: ['CREDIT', 'DEBIT'], required: true, immutable: true },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true, immutable: true },
    currency: { type: String, required: true, default: 'INR', immutable: true },
    description: { type: String, required: true, maxlength: 300, immutable: true },
    relatedEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateWalletEntry', default: null, immutable: true },
    effectiveAt: { type: Date, required: true, default: Date.now, immutable: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true },
}, { timestamps: true, strict: 'throw' });

affiliateWalletEntrySchema.index({ affiliate: 1, effectiveAt: -1, _id: -1 });
affiliateWalletEntrySchema.index({ sourceType: 1, sourceId: 1 });
affiliateWalletEntrySchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function rejectMutation() {
    throw new Error('Affiliate wallet entries are append-only; post a compensating entry.');
});

module.exports = mongoose.model('AffiliateWalletEntry', affiliateWalletEntrySchema);
