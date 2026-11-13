
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, unique: true, sparse: true }, // Sparse allows multiple nulls
    password: { type: String },
    phone: { type: String, unique: true, sparse: true },
    isAdmin: { type: Boolean, default: false },
    roles: {
        type: [{ type: String, enum: ['customer', 'affiliate_partner', 'support_agent', 'doctor', 'finance_operator', 'affiliate_manager', 'super_admin'] }],
        default: ['customer'],
    },
    accountStatus: { type: String, enum: ['ACTIVE', 'SUSPENDED', 'TERMINATED'], default: 'ACTIVE', index: true },
    phoneVerifiedAt: { type: Date, default: null },
    mfaEnabled: { type: Boolean, default: false },
    mfaSecretEncrypted: { type: Buffer, select: false },
    mfaSecretIv: { type: Buffer, select: false },
    mfaSecretAuthTag: { type: Buffer, select: false },
    mfaEnabledAt: { type: Date, default: null },
    otp: { type: String },
    otpExpires: { type: Date },
    addresses: [{
        name: { type: String, required: true },
        phone: { type: String, required: true },
        type: { type: String, enum: ['Home', 'Work', 'Other'], default: 'Home' },
        street: { type: String, required: true },
        city: { type: String, required: true },
        state: { type: String, required: true },
        pincode: { type: String, required: true },
        country: { type: String, default: 'India' },
        isDefault: { type: Boolean, default: false }
    }]
}, { timestamps: true });

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
    if (!this.password) return false;
    return await bcrypt.compare(enteredPassword, this.password);
};

// Encrypt password using bcrypt
userSchema.pre('save', async function () {
    if (!this.isModified('password') || !this.password) {
        return;
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

module.exports = mongoose.model('User', userSchema);
