
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { startOtpVerification, checkOtpVerification } = require('../utils/twilioService');
const jwt = require('jsonwebtoken');
const { encryptKycData, decryptKycData } = require('../utils/kycEncryption');
const { generateTotpSecret, verifyTotp } = require('../utils/totp');

const isPrivilegedUser = (user) => user.isAdmin
    || (user.roles || []).some((role) => !['customer', 'affiliate_partner'].includes(role));

function issueMfaChallenge(user, res) {
    const challengeToken = jwt.sign(
        { id: user._id, purpose: 'privileged-mfa' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' },
    );
    return res.json({ success: true, mfaRequired: true, challengeToken });
}

// @desc    Auth user & get token
// @route   POST /api/users/login
// @access  Public
const authUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email: email?.trim().toLowerCase() });

        if (user && (user.accountStatus === 'ACTIVE' || !user.accountStatus) && (await user.matchPassword(password))) {
            if (isPrivilegedUser(user) && user.mfaEnabled) return issueMfaChallenge(user, res);
            const token = generateToken(user._id);

            // Set HTTP-only cookie
            res.cookie('jwt', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV !== 'development',
                sameSite: 'strict',
                maxAge: 30 * 24 * 60 * 60 * 1000
            });

            res.json({
                _id: user._id,
                name: user.name,
                email: user.email,
                isAdmin: user.isAdmin ,
                roles: user.roles || [],
                mfaEnabled: user.mfaEnabled,
                token: token,
            });
        } else {
            res.status(401).json({ message: 'Invalid email or password' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Register a new user
// @route   POST /api/users
// @access  Public
const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const userExists = await User.findOne({ email });

        if (userExists) {
            res.status(400).json({ message: 'User already exists' });
            return;
        }

        const user = await User.create({
            name,
            email,
            password,
            isAdmin: false,
        });

        if (user) {
            res.status(201).json({
                _id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                isAdmin: user.isAdmin,
                token: generateToken(user._id),
            });
        } else {
            res.status(400).json({ message: 'Invalid user data' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (user) {
            res.json({
                _id: user._id,
                name: user.name,
                email: user.email,
                isAdmin: user.isAdmin,
                roles: user.roles || [],
                mfaEnabled: user.mfaEnabled,
                addresses: user.addresses // Include addresses
            });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (user) {
            user.name = req.body.name || user.name;
            user.email = req.body.email || user.email;
            user.phone = req.body.phone || user.phone;

            if (req.body.password) {
                user.password = req.body.password;
            }

            const updatedUser = await user.save();

            res.json({
                _id: updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                phone: updatedUser.phone,
                isAdmin: updatedUser.isAdmin,
                token: generateToken(updatedUser._id),
            });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const changeUserPassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8) {
            return res.status(400).json({ message: 'Enter your current password and a new password of at least 8 characters.' });
        }

        const user = await User.findById(req.user._id);
        if (!user || !(await user.matchPassword(currentPassword))) {
            return res.status(401).json({ message: 'Current password is incorrect.' });
        }

        user.password = newPassword;
        await user.save();
        res.json({ message: 'Password updated successfully.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Add new address
// @route   POST /api/users/address
// @access  Private
const addUserAddress = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const { name, phone, type, street, city, state, pincode, country, isDefault } = req.body;

        // If this is set as default, unset others
        if (isDefault) {
            user.addresses.forEach(addr => { addr.isDefault = false; });
        }

        // If first address, make it default
        const makeDefault = user.addresses.length === 0 ? true : (isDefault || false);

        user.addresses.push({
            name, phone, type: type || 'Home',
            street, city, state, pincode,
            country: country || 'India',
            isDefault: makeDefault
        });

        await user.save();
        res.status(201).json(user.addresses);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get all user addresses
// @route   GET /api/users/addresses
// @access  Private
const getUserAddresses = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json(user.addresses);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Update address
// @route   PUT /api/users/address/:addressId
// @access  Private
const updateUserAddress = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const address = user.addresses.id(req.params.addressId);

        if (!address) {
            return res.status(404).json({ message: 'Address not found' });
        }

        const { name, phone, type, street, city, state, pincode, country, isDefault } = req.body;

        // If setting as default, unset others
        if (isDefault) {
            user.addresses.forEach(addr => { addr.isDefault = false; });
        }

        if (name) address.name = name;
        if (phone) address.phone = phone;
        if (type) address.type = type;
        if (street) address.street = street;
        if (city) address.city = city;
        if (state) address.state = state;
        if (pincode) address.pincode = pincode;
        if (country) address.country = country;
        if (isDefault !== undefined) address.isDefault = isDefault;

        await user.save();
        res.json(user.addresses);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Delete address
// @route   DELETE /api/users/address/:addressId
// @access  Private
const deleteUserAddress = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const address = user.addresses.id(req.params.addressId);

        if (!address) {
            return res.status(404).json({ message: 'Address not found' });
        }

        user.addresses.pull(req.params.addressId);
        await user.save();
        res.json(user.addresses);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Send OTP to phone
// @route   POST /api/users/send-otp
// @access  Public
const sendOTP = async (req, res) => {
    try {
        const { phone } = req.body;

        if (typeof phone !== 'string' || !phone) {
            return res.status(400).json({ success: false, message: 'Phone number is required' });
        }

        if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
            return res.status(400).json({ success: false, message: 'Phone number must use international format, such as +919876543210' });
        }

        let user = await User.findOne({ phone });

        if (!user) {
            // Auto-register if user doesn't exist
            user = await User.create({
                name: `User ${phone.slice(-4)}`,
                phone
            });
        }

        try {
            user.otp = undefined;
            user.otpExpires = undefined;
            await user.save();
            await startOtpVerification(phone);
        } catch (error) {
            const twilioMessage = error.response?.data?.message || error.message;
            const twilioCode = error.response?.data?.code;
            console.error('TWILIO_SEND_OTP_ERROR:', { code: twilioCode, message: twilioMessage });

            const trialRecipientError = /verified recipient|trial account/i.test(twilioMessage || '');
            const message = trialRecipientError
                ? 'This Twilio trial account can only send OTPs to verified recipient numbers. Verify this phone number in Twilio or upgrade the account.'
                : 'Failed to send OTP. Please try again later.';
            return res.status(502).json({ success: false, message });
        }

        res.json({
            success: true,
            message: 'OTP sent successfully',
            phone,
            isNewUser: user.name.startsWith('User ')
        });
    } catch (error) {
        console.error('SEND_OTP_ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Verify OTP and login
// @route   POST /api/users/verify-otp
// @access  Public
const verifyOTP = async (req, res) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({ success: false, message: 'Phone and OTP are required' });
        }

        const user = await User.findOne({ phone });

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        let verification;
        try {
            verification = await checkOtpVerification(phone, String(otp));
        } catch (error) {
            const twilioMessage = error.response?.data?.message || error.message;
            const twilioCode = error.response?.data?.code;
            console.error('TWILIO_VERIFY_OTP_ERROR:', { code: twilioCode, message: twilioMessage });

            if (error.response?.status === 404) {
                return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
            }
            return res.status(502).json({ success: false, message: 'OTP verification is temporarily unavailable. Please try again.' });
        }

        if (verification.data.status === 'approved') {
            const isNewUser = user.name.startsWith('User ');

            user.otp = undefined;
            user.otpExpires = undefined;
            user.phoneVerifiedAt = new Date();
            await user.save();
            if (isPrivilegedUser(user) && user.mfaEnabled) return issueMfaChallenge(user, res);
            const token = generateToken(user._id);

            // Set HTTP-only cookie
            res.cookie('jwt', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV !== 'development', // Use secure in production
                sameSite: 'strict',
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });

            res.json({
                success: true,
                _id: user._id,
                name: user.name,
                phone: user.phone,
                email: user.email,

                // ...(user.isAdmin && { isAdmin: true }),

                token: token, // Still return token for potential frontend use, but cookie is primary
                isNewUser
            });
        } else {
            res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
        }
    } catch (error) {
        console.error('VERIFY_OTP_ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const setupMfa = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user || (user.accountStatus && user.accountStatus !== 'ACTIVE')) {
            return res.status(403).json({ message: 'This account is not active.' });
        }
        if (user.mfaEnabled) return res.status(409).json({ message: 'MFA is already enabled.' });

        const secret = generateTotpSecret();
        const encrypted = encryptKycData(Buffer.from(secret, 'utf8'));
        user.mfaSecretEncrypted = encrypted.encrypted;
        user.mfaSecretIv = encrypted.iv;
        user.mfaSecretAuthTag = encrypted.authTag;
        await user.save();

        const label = encodeURIComponent(`${process.env.MFA_ISSUER || 'AyuvaPro'}:${user.email || user.phone || user._id}`);
        const issuer = encodeURIComponent(process.env.MFA_ISSUER || 'AyuvaPro');
        res.json({
            secret,
            otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
            expiresInSeconds: 300,
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ message: error.message });
    }
};

const confirmMfa = async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('+mfaSecretEncrypted +mfaSecretIv +mfaSecretAuthTag');
        if (!user || !user.mfaSecretEncrypted) return res.status(409).json({ message: 'Start MFA setup first.' });
        const secret = decryptKycData(user.mfaSecretEncrypted, user.mfaSecretIv, user.mfaSecretAuthTag).toString('utf8');
        if (!verifyTotp(secret, req.body.code)) return res.status(400).json({ message: 'Authenticator code is invalid or expired.' });

        user.mfaEnabled = true;
        user.mfaEnabledAt = new Date();
        await user.save();
        const token = isPrivilegedUser(user)
            ? generateToken(user._id, { mfaVerified: true, expiresIn: '8h' })
            : generateToken(user._id);
        res.json({ success: true, token, mfaEnabled: true });
    } catch (error) {
        res.status(error.statusCode || 500).json({ message: error.message });
    }
};

const verifyMfaChallenge = async (req, res) => {
    try {
        const challenge = jwt.verify(req.body.challengeToken, process.env.JWT_SECRET);
        if (challenge.purpose !== 'privileged-mfa') return res.status(401).json({ message: 'Invalid MFA challenge.' });
        const user = await User.findById(challenge.id)
            .select('+mfaSecretEncrypted +mfaSecretIv +mfaSecretAuthTag');
        if (!user || !user.mfaEnabled || !isPrivilegedUser(user)) {
            return res.status(401).json({ message: 'MFA is not enabled for this account.' });
        }
        const secret = decryptKycData(user.mfaSecretEncrypted, user.mfaSecretIv, user.mfaSecretAuthTag).toString('utf8');
        if (!verifyTotp(secret, req.body.code)) return res.status(401).json({ message: 'Authenticator code is invalid or expired.' });

        const token = generateToken(user._id, { mfaVerified: true, expiresIn: '8h' });
        res.cookie('jwt', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV !== 'development',
            sameSite: 'strict',
            maxAge: 8 * 60 * 60 * 1000,
        });
        res.json({ success: true, token });
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'MFA challenge is invalid or expired.' });
        }
        res.status(error.statusCode || 500).json({ message: error.message });
    }
};

// @desc    Forgot Password (Mock)
// @route   POST /api/users/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
    try {
        const { phone } = req.body;
        const user = await User.findOne({ phone });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ message: 'OTP sent to your phone for password reset' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Logout user / clear cookie
// @route   POST /api/users/logout
// @access  Public
const logoutUser = (req, res) => {
    res.cookie('jwt', '', {
        httpOnly: true,
        expires: new Date(0)
    });
    res.status(200).json({ message: 'Logged out successfully' });
};

module.exports = {
    authUser,
    registerUser,
    getUserProfile,
    updateUserProfile,
    changeUserPassword,
    addUserAddress,
    getUserAddresses,
    updateUserAddress,
    deleteUserAddress,
    sendOTP,
    verifyOTP,
    setupMfa,
    confirmMfa,
    verifyMfaChallenge,
    forgotPassword,
    logoutUser
};
