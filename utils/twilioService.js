const axios = require('axios');

const sendOtpSms = async (phone, otp) => {
    const accountSid = process.env.Twilio_ACCOUNT_SID;
    const authToken = process.env.Twilio_AUTH_TOKEN;
    const fromNumber = process.env.Twilio_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
        throw new Error('Twilio SMS credentials are not configured');
    }

    const form = new URLSearchParams({
        To: phone,
        From: fromNumber,
        Body: `Your AyurvaPro verification code is ${otp}. It expires in 10 minutes.`
    });
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;

    return axios.post(url, form.toString(), {
        auth: { username: accountSid, password: authToken },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
};

module.exports = { sendOtpSms };