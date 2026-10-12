const mongoose = require('mongoose');

const mlmVolumeEventSchema = new mongoose.Schema({
    recipientMember: { type: mongoose.Schema.Types.ObjectId, ref: 'MlmMember', required: true, index: true },
    sourceMember: { type: mongoose.Schema.Types.ObjectId, ref: 'MlmMember', required: true },
    side: { type: String, enum: ['left', 'right'], required: true },
    businessVolume: { type: Number, required: true, min: 0 },
    dateKey: { type: String, required: true },
    processedAt: { type: Date, default: null },
}, { timestamps: true });

mlmVolumeEventSchema.index({ sourceMember: 1, recipientMember: 1 }, { unique: true });
mlmVolumeEventSchema.index({ dateKey: 1, recipientMember: 1, processedAt: 1 });

module.exports = mongoose.model('MlmVolumeEvent', mlmVolumeEventSchema);