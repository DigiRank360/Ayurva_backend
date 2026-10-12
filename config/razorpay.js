const Razorpay = require('razorpay');

function getRazorpayCredentials() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
        const error = new Error('Package payments are not configured. Contact support to activate this account.');
        error.statusCode = 503;
        throw error;
    }
    return { keyId, keySecret };
}

function createRazorpayClient() {
    const { keyId, keySecret } = getRazorpayCredentials();
    return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

module.exports = { createRazorpayClient, getRazorpayCredentials };