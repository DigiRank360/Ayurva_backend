const mongoose = require('mongoose');

const affiliateNotificationSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    eventType: { type: String, required: true, maxlength: 80 },
    channel: { type: String, enum: ['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP'], required: true },
    dedupeKey: { type: String, required: true, unique: true },
    templateVersion: { type: String, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['QUEUED', 'SENT', 'FAILED', 'READ'], default: 'QUEUED', index: true },
    attempts: { type: Number, default: 0, min: 0 },
    sentAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    lastErrorCode: { type: String, default: null, maxlength: 80 },
}, { timestamps: true, strict: 'throw' });

affiliateNotificationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('AffiliateNotification', affiliateNotificationSchema);
