
const mongoose = require('mongoose');

const paymentSchema = mongoose.Schema(
    {
        razorpayOrderId: {
            type: String,
            default: null,
        },
        razorpayPaymentId: {
            type: String,
            default: null,
        },
        razorpaySignature: {
            type: String,
            default: null,
        },
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Order',
            required: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 1,
        },
        currency: {
            type: String,
            required: true,
            default: 'INR',
        },
        status: {
            type: String,
            enum: ['Created', 'Captured', 'Failed', 'Refunded', 'Pending'],
            default: 'Created',
            index: true,
        },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
        verifiedAt: { type: Date, default: null },
        capturedAt: { type: Date, default: null },
        providerEventId: { type: String, default: null },
        failureCode: { type: String, default: null, maxlength: 80 },
        refundedAmountMinor: { type: Number, default: 0, min: 0 },
    },
    {
        timestamps: true,
    }
);

paymentSchema.index({ razorpayOrderId: 1 }, {
    unique: true,
    partialFilterExpression: { razorpayOrderId: { $type: 'string' } },
});
paymentSchema.index({ razorpayPaymentId: 1 }, {
    unique: true,
    partialFilterExpression: { razorpayPaymentId: { $type: 'string' } },
});
paymentSchema.index({ orderId: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
