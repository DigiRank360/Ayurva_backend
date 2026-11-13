const mongoose = require('mongoose');

const affiliateCommissionAdjustmentSchema = new mongoose.Schema({
    commission: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateCommission', required: true, immutable: true, index: true },
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true, immutable: true, index: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, immutable: true },
    providerEventId: { type: String, required: true, unique: true, immutable: true },
    type: { type: String, enum: ['PARTIAL_REFUND', 'FULL_REFUND', 'CHARGEBACK', 'CANCELLATION'], required: true, immutable: true },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true, immutable: true },
    currency: { type: String, required: true, default: 'INR', immutable: true },
    status: { type: String, enum: ['POSTED', 'ON_HOLD'], default: 'POSTED', immutable: true },
    ruleSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
    occurredAt: { type: Date, required: true, immutable: true },
}, { timestamps: true, strict: 'throw' });

affiliateCommissionAdjustmentSchema.index({ order: 1, occurredAt: 1 });
affiliateCommissionAdjustmentSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function rejectMutation() {
    throw new Error('Commission adjustments are immutable; record a compensating event.');
});

module.exports = mongoose.model('AffiliateCommissionAdjustment', affiliateCommissionAdjustmentSchema);
