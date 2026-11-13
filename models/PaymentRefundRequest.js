const mongoose = require('mongoose');

const paymentRefundRequestSchema = new mongoose.Schema({
    returnRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'Return', required: true, unique: true, immutable: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, immutable: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, immutable: true },
    amountMinor: { type: Number, required: true, min: 1, immutable: true },
    providerRefundId: { type: String, default: null },
    status: { type: String, enum: ['REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED'], default: 'REQUESTED', index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    failureReason: { type: String, default: null, maxlength: 300 },
    completedAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });

paymentRefundRequestSchema.index(
    { providerRefundId: 1 },
    { unique: true, partialFilterExpression: { providerRefundId: { $type: 'string' } } },
);

module.exports = mongoose.model('PaymentRefundRequest', paymentRefundRequestSchema);
