const crypto = require('crypto');

function getSupportKey() {
    const value = process.env.AFFILIATE_SUPPORT_ENCRYPTION_KEY;
    if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
        const error = new Error('Affiliate support note storage is not configured.');
        error.statusCode = 503;
        throw error;
    }
    return Buffer.from(value, 'hex');
}

function encryptSupportNote(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getSupportKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { encrypted, iv, authTag: cipher.getAuthTag() };
}

function decryptSupportNote(encrypted, iv, authTag) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getSupportKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = { decryptSupportNote, encryptSupportNote };
