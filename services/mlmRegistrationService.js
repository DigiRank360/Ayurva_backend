const jwt = require('jsonwebtoken');
const { startOtpVerification, checkOtpVerification } = require('../utils/twilioService');
const { encryptKycData, getEncryptionKey, hashKycIdentifier } = require('../utils/kycEncryption');

const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_PATTERN = /^\d{9,18}$/;
const TOKEN_PURPOSE = 'mlm-phone-verification';
const TOKEN_TTL = '20m';

function registrationError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function isPhoneOtpEnabled() {
    return Boolean(process.env.Twilio_ACCOUNT_SID && process.env.Twilio_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID);
}

function isPayoutStorageEnabled() {
    try {
        getEncryptionKey();
        return true;
    } catch {
        return false;
    }
}

function getRegistrationConfig() {
    return { phoneOtpEnabled: isPhoneOtpEnabled(), payoutDetailsEnabled: isPayoutStorageEnabled() };
}

function assertPhone(phone) {
    if (typeof phone !== 'string' || !PHONE_PATTERN.test(phone.trim())) {
        throw registrationError('Phone number must use international format, such as +919876543210.');
    }
    return phone.trim();
}

async function sendPhoneOtp(phone) {
    const normalized = assertPhone(phone);
    if (!isPhoneOtpEnabled()) throw registrationError('Phone verification is not available right now.', 503);
    try {
        await startOtpVerification(normalized);
    } catch (error) {
        console.error('MLM_SEND_OTP_ERROR:', error.response?.data?.message || error.message);
        throw registrationError('Could not send the OTP. Check the number and try again later.', 502);
    }
    return { sent: true };
}

async function verifyPhoneOtp(phone, code) {
    const normalized = assertPhone(phone);
    if (!isPhoneOtpEnabled()) throw registrationError('Phone verification is not available right now.', 503);
    if (typeof code !== 'string' || !/^\d{4,8}$/.test(code.trim())) throw registrationError('Enter the OTP you received.');
    let approved = false;
    try {
        const response = await checkOtpVerification(normalized, code.trim());
        approved = response.data?.status === 'approved';
    } catch (error) {
        if (error.response?.status !== 404) {
            console.error('MLM_VERIFY_OTP_ERROR:', error.response?.data?.message || error.message);
        }
    }
    if (!approved) throw registrationError('The OTP is incorrect or has expired.');
    const verificationToken = jwt.sign({ purpose: TOKEN_PURPOSE, phone: normalized }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
    return { verified: true, verificationToken };
}

function assertPhoneVerified(phone, token) {
    if (!isPhoneOtpEnabled()) return;
    let payload;
    try {
        payload = jwt.verify(token || '', process.env.JWT_SECRET);
    } catch {
        throw registrationError('Verify your mobile number with an OTP to continue.');
    }
    if (payload.purpose !== TOKEN_PURPOSE || payload.phone !== phone) {
        throw registrationError('Verify your mobile number with an OTP to continue.');
    }
}

// Validates and encrypts payout details. Returns null when the feature is unavailable and nothing was sent.
function buildPayoutAccount(input, legalName) {
    if (!input) {
        if (isPayoutStorageEnabled()) throw registrationError('PAN and bank account details are required.');
        return null;
    }
    if (!isPayoutStorageEnabled()) throw registrationError('Secure payout storage is not configured. Contact support.', 503);
    const clean = (value) => (typeof value === 'string' ? value.trim() : '');
    const pan = clean(input.pan).toUpperCase();
    const accountNumber = clean(input.accountNumber).replace(/\s/g, '');
    const ifsc = clean(input.ifsc).toUpperCase();
    const accountHolderName = clean(input.accountHolderName).replace(/\s+/g, ' ');
    if (!PAN_PATTERN.test(pan)) throw registrationError('Enter a valid 10-character PAN, such as ABCDE1234F.');
    if (!accountHolderName) throw registrationError('Bank account holder name is required.');
    if (!ACCOUNT_PATTERN.test(accountNumber)) throw registrationError('Enter a valid bank account number (9-18 digits).');
    if (!IFSC_PATTERN.test(ifsc)) throw registrationError('Enter a valid IFSC code, such as HDFC0001234.');
    if (accountNumber !== clean(input.confirmAccountNumber).replace(/\s/g, '')) {
        throw registrationError('Bank account numbers do not match.');
    }

    const encryptedPan = encryptKycData(Buffer.from(pan));
    const encryptedAccount = encryptKycData(Buffer.from(accountNumber));
    return {
        panEncrypted: encryptedPan.encrypted,
        panIv: encryptedPan.iv,
        panAuthTag: encryptedPan.authTag,
        panHash: hashKycIdentifier(pan),
        panLastFour: pan.slice(-4),
        accountHolderName,
        accountNumberEncrypted: encryptedAccount.encrypted,
        accountNumberIv: encryptedAccount.iv,
        accountNumberAuthTag: encryptedAccount.authTag,
        accountNumberLastFour: accountNumber.slice(-4),
        ifsc,
        holderNameMatchesLegalName: accountHolderName.toLowerCase() === clean(legalName).replace(/\s+/g, ' ').toLowerCase(),
    };
}

module.exports = {
    assertPhoneVerified,
    buildPayoutAccount,
    getRegistrationConfig,
    sendPhoneOtp,
    verifyPhoneOtp,
};
