const mongoose = require('mongoose');

const mlmPayoutRunSchema = new mongoose.Schema({
    dateKey: { type: String, required: true, unique: true },
    status: { type: String, enum: ['processing', 'completed', 'failed'], required: true },
    lockToken: { type: String, default: null },
    lockUntil: { type: Date, default: null },
    processedMembers: { type: Number, default: 0 },
    matchedPairs: { type: Number, default: 0 },
    totalPaid: { type: Number, default: 0 },
    totalFlushed: { type: Number, default: 0 },
    error: { type: String, default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('MlmPayoutRun', mlmPayoutRunSchema);