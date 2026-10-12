const test = require('node:test');
const assert = require('node:assert/strict');
const {
    decryptKycData,
    encryptKycData,
    getEncryptionKey,
    hashKycIdentifier,
} = require('../utils/kycEncryption');

const TEST_KEY = 'a'.repeat(64);

function withTestKey(run) {
    const previousKey = process.env.KYC_ENCRYPTION_KEY;
    process.env.KYC_ENCRYPTION_KEY = TEST_KEY;
    try {
        run();
    } finally {
        if (previousKey === undefined) delete process.env.KYC_ENCRYPTION_KEY;
        else process.env.KYC_ENCRYPTION_KEY = previousKey;
    }
}

test('KYC AES-GCM encryption decrypts only with a valid authentication tag', () => {
    withTestKey(() => {
        const plaintext = Buffer.from('synthetic PAN test value');
        const encrypted = encryptKycData(plaintext);

        assert.deepEqual(decryptKycData(encrypted.encrypted, encrypted.iv, encrypted.authTag), plaintext);
        assert.throws(() => decryptKycData(encrypted.encrypted, encrypted.iv, Buffer.alloc(16)));
    });
});

test('KYC identifier lookup uses a stable keyed hash without storing the plaintext', () => {
    withTestKey(() => {
        assert.equal(hashKycIdentifier('ABCDE1234F'), hashKycIdentifier('ABCDE1234F'));
        assert.notEqual(hashKycIdentifier('ABCDE1234F'), hashKycIdentifier('ABCDE1234G'));
    });
});

test('KYC encryption fails closed when the environment key is missing or malformed', () => {
    const previousKey = process.env.KYC_ENCRYPTION_KEY;
    delete process.env.KYC_ENCRYPTION_KEY;
    try {
        assert.throws(() => getEncryptionKey(), { statusCode: 503 });
        process.env.KYC_ENCRYPTION_KEY = 'invalid';
        assert.throws(() => encryptKycData(Buffer.from('private data')), { statusCode: 503 });
    } finally {
        if (previousKey === undefined) delete process.env.KYC_ENCRYPTION_KEY;
        else process.env.KYC_ENCRYPTION_KEY = previousKey;
    }
});
