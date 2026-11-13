const mongoose = require('mongoose');

const paymentRefundEventSchema = new mongoose.Schema({
    providerEventId: { type: String, required: true, unique: true, immutable: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, immutable: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, immutable: true },
    amountMinor: { type: Number, required: true, min: 1, immutable: true },
    occurredAt: { type: Date, required: true, immutable: true },
}, { timestamps: true, strict: 'throw' });

module.exports = mongoose.model('PaymentRefundEvent', paymentRefundEventSchema);
