const mongoose = require('mongoose');

const affiliateAuditLogSchema = new mongoose.Schema({
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true },
    action: { type: String, required: true, maxlength: 120, immutable: true },
    resourceType: { type: String, required: true, maxlength: 80, immutable: true },
    resourceId: { type: String, required: true, maxlength: 120, immutable: true },
    reason: { type: String, default: null, maxlength: 500, immutable: true },
    before: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
    after: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
    requestId: { type: String, default: null, maxlength: 120, immutable: true },
    ipHash: { type: String, default: null, select: false, immutable: true },
    userAgent: { type: String, default: null, maxlength: 300, immutable: true },
    occurredAt: { type: Date, required: true, default: Date.now, immutable: true },
}, { timestamps: false, strict: 'throw' });

affiliateAuditLogSchema.index({ resourceType: 1, resourceId: 1, occurredAt: -1 });
affiliateAuditLogSchema.index({ actor: 1, occurredAt: -1 });
affiliateAuditLogSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function rejectMutation() {
    throw new Error('Audit records are immutable.');
});

module.exports = mongoose.model('AffiliateAuditLog', affiliateAuditLogSchema);
