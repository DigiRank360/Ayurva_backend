const mongoose = require('mongoose');

const packageSnapshotSchema = new mongoose.Schema({
    mrp: { type: Number, required: true },
    discountedPrice: { type: Number, required: true },
    businessVolume: { type: Number, required: true },
    matchingBonus: { type: Number, required: true },
    dailyMatchingCap: { type: Number, required: true },
}, { _id: false });

const applicantProfileSchema = new mongoose.Schema({
    category: { type: String, enum: ['ayurvedic_practitioner', 'wellness_professional', 'health_advocate', 'other'] },
    councilRegistrationNo: { type: String, default: '', trim: true, maxlength: 60 },
    organizationName: { type: String, default: '', trim: true, maxlength: 120 },
    state: { type: String, default: '', trim: true, maxlength: 60 },
    city: { type: String, default: '', trim: true, maxlength: 60 },
    pinCode: { type: String, default: '', trim: true },
    undertakingAcceptedAt: { type: Date, default: null },
}, { _id: false });

const mlmMemberSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    memberCode: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['pending', 'active', 'suspended'], default: 'pending', index: true },
    applicantProfile: { type: applicantProfileSchema, default: null },
    kycStatus: { type: String, enum: ['not_submitted', 'submitted', 'under_review', 'approved', 'rejected'], default: 'not_submitted', index: true },
    kycVerifiedAt: { type: Date, default: null },
    packageId: { type: String, required: true, enum: ['starter', 'growth', 'elite'] },
    packageSnapshot: { type: packageSnapshotSchema, required: true },
    requestedSponsorCode: { type: String, default: null },
    requestedPlacementCode: { type: String, default: null },
    requestedPlacementLeg: { type: String, enum: ['left', 'right', null], default: null },
    sponsorMember: { type: mongoose.Schema.Types.ObjectId, ref: 'MlmMember', default: null },
    placementParent: { type: mongoose.Schema.Types.ObjectId, ref: 'MlmMember', default: null },
    placementLeg: { type: String, enum: ['left', 'right', null], default: null },
    activationReference: { type: String, unique: true, sparse: true },
    activatedAt: { type: Date, default: null },
    firstMatchCompleted: { type: Boolean, default: false },
    carriedLeftMembers: { type: Number, default: 0, min: 0 },
    carriedRightMembers: { type: Number, default: 0, min: 0 },
    walletBalance: { type: Number, default: 0, min: 0 },
    totalEarnings: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

mlmMemberSchema.index(
    { placementParent: 1, placementLeg: 1 },
    { unique: true, partialFilterExpression: { placementLeg: { $type: 'string' } } },
);

module.exports = mongoose.model('MlmMember', mlmMemberSchema);