const mongoose = require('mongoose');

const offerRedemptionSchema = new mongoose.Schema({
    offer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', required: true, immutable: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true, immutable: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    code: { type: String, required: true, immutable: true, maxlength: 40 },
    discountAmount: { type: Number, required: true, min: 0, immutable: true },
    status: { type: String, enum: ['RESERVED', 'REDEEMED', 'RELEASED'], default: 'RESERVED', index: true },
    expiresAt: { type: Date, default: null, index: true },
}, { timestamps: true, strict: 'throw' });

module.exports = mongoose.model('OfferRedemption', offerRedemptionSchema);
