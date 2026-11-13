const mongoose = require('mongoose');

const affiliatePayoutTransactionSchema = new mongoose.Schema({
    payoutRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliatePayoutRequest', required: true, immutable: true },
    idempotencyKey: { type: String, required: true, unique: true, immutable: true },
    eventType: { type: String, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSING', 'PAID', 'FAILED'], required: true, immutable: true },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true, immutable: true },
    providerReference: { type: String, default: null, maxlength: 120, immutable: true },
    reason: { type: String, default: null, maxlength: 500, immutable: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    occurredAt: { type: Date, required: true, default: Date.now, immutable: true },
}, { timestamps: true, strict: 'throw' });

affiliatePayoutTransactionSchema.index({ payoutRequest: 1, occurredAt: 1 });
affiliatePayoutTransactionSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function rejectMutation() {
    throw new Error('Payout transactions are immutable; record a correction event.');
});

module.exports = mongoose.model('AffiliatePayoutTransaction', affiliatePayoutTransactionSchema);
