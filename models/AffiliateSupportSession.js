const mongoose = require('mongoose');

const affiliateSupportSessionSchema = new mongoose.Schema({
    entitlement: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateSupportEntitlement', required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignedDoctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    assignedAgent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    scheduledAt: { type: Date, default: null, index: true },
    status: { type: String, enum: ['NOT_SCHEDULED', 'SCHEDULED', 'COMPLETED', 'CUSTOMER_UNAVAILABLE', 'RESCHEDULED', 'CANCELLED', 'MISSED'], default: 'NOT_SCHEDULED', index: true },
    customerConsentAt: { type: Date, default: null },
    notesEncrypted: { type: Buffer, default: null, select: false },
    notesIv: { type: Buffer, default: null, select: false },
    notesAuthTag: { type: Buffer, default: null, select: false },
    outcomeCode: { type: String, default: null, maxlength: 80 },
    rescheduleReason: { type: String, default: null, maxlength: 500 },
    completedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, strict: 'throw' });

affiliateSupportSessionSchema.index({ assignedDoctor: 1, scheduledAt: 1 });
affiliateSupportSessionSchema.index({ customer: 1, createdAt: -1 });

module.exports = mongoose.model('AffiliateSupportSession', affiliateSupportSessionSchema);
