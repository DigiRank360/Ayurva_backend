const crypto = require('crypto');

function getEncryptionKey() {
    const encodedKey = process.env.KYC_ENCRYPTION_KEY;
    if (!encodedKey || !/^[a-f0-9]{64}$/i.test(encodedKey)) {
        const error = new Error('KYC document storage is not configured. Contact support.');
        error.statusCode = 503;
        throw error;
    }
    return Buffer.from(encodedKey, 'hex');
}

function encryptKycData(data) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    return { encrypted, iv, authTag: cipher.getAuthTag() };
}

function decryptKycData(encrypted, iv, authTag) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function hashKycIdentifier(value) {
    return crypto.createHmac('sha256', getEncryptionKey()).update(value).digest('hex');
}

module.exports = { decryptKycData, encryptKycData, getEncryptionKey, hashKycIdentifier };