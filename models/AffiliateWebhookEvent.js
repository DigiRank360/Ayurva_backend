const mongoose = require('mongoose');

const affiliateWebhookEventSchema = new mongoose.Schema({
    provider: { type: String, required: true, immutable: true },
    sourceEventId: { type: String, required: true, immutable: true },
    eventType: { type: String, required: true, immutable: true },
    payloadHash: { type: String, required: true, immutable: true },
    status: { type: String, enum: ['RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED'], default: 'RECEIVED', index: true },
    lockUntil: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    processingError: { type: String, default: null, maxlength: 300 },
    receivedAt: { type: Date, required: true, default: Date.now, immutable: true },
}, { timestamps: false, strict: 'throw' });

affiliateWebhookEventSchema.index({ provider: 1, sourceEventId: 1 }, { unique: true });

module.exports = mongoose.model('AffiliateWebhookEvent', affiliateWebhookEventSchema);
