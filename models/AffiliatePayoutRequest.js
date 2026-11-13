const mongoose = require('mongoose');

const affiliatePayoutRequestSchema = new mongoose.Schema({
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true },
    method: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliatePayoutMethod', required: true },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true, immutable: true },
    currency: { type: String, required: true, default: 'INR', immutable: true },
    methodSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
    status: { type: String, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSING', 'PAID', 'FAILED'], default: 'REQUESTED', index: true },
    requestedAt: { type: Date, required: true, default: Date.now, immutable: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    executedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    executedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null, maxlength: 500 },
    failureReason: { type: String, default: null, maxlength: 500 },
}, { timestamps: true, strict: 'throw' });

affiliatePayoutRequestSchema.index({ affiliate: 1, createdAt: -1 });
affiliatePayoutRequestSchema.index({ status: 1, requestedAt: 1 });

module.exports = mongoose.model('AffiliatePayoutRequest', affiliatePayoutRequestSchema);
