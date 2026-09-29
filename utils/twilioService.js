const axios = require('axios');

const getTwilioConfig = () => {
    const accountSid = process.env.Twilio_ACCOUNT_SID;
    const authToken = process.env.Twilio_AUTH_TOKEN;
    const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

    if (!accountSid || !authToken || !verifyServiceSid) {
        throw new Error('Twilio Verify is not configured. Set Twilio_ACCOUNT_SID, Twilio_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID.');
    }

    return { accountSid, authToken, verifyServiceSid };
};

const getVerifyUrl = (verifyServiceSid, endpoint) =>
    `https://verify.twilio.com/v2/Services/${encodeURIComponent(verifyServiceSid)}/${endpoint}`;

const startOtpVerification = async (phone) => {
    const { accountSid, authToken, verifyServiceSid } = getTwilioConfig();

    return axios.post(getVerifyUrl(verifyServiceSid, 'Verifications'), new URLSearchParams({
        To: phone,
        Channel: 'sms'
    }).toString(), {
        auth: { username: accountSid, password: authToken },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
};

const checkOtpVerification = async (phone, code) => {
    const { accountSid, authToken, verifyServiceSid } = getTwilioConfig();

    return axios.post(getVerifyUrl(verifyServiceSid, 'VerificationCheck'), new URLSearchParams({
        To: phone,
        Code: code
    }).toString(), {
        auth: { username: accountSid, password: authToken },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
};

module.exports = { startOtpVerification, checkOtpVerification };