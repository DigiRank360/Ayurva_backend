const crypto = require('crypto');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(buffer) {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
    return output;
}

function decodeBase32(value) {
    const text = value.toUpperCase().replace(/=+$/g, '');
    let bits = 0;
    let accumulator = 0;
    const output = [];
    for (const character of text) {
        const index = BASE32.indexOf(character);
        if (index < 0) throw new TypeError('Invalid authenticator secret.');
        accumulator = (accumulator << 5) | index;
        bits += 5;
        if (bits >= 8) {
            output.push((accumulator >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(output);
}

function generateTotpSecret() {
    return encodeBase32(crypto.randomBytes(20));
}

function makeTotpCode(secret, counter) {
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
    const offset = digest[digest.length - 1] & 15;
    const binary = digest.readUInt32BE(offset) & 0x7fffffff;
    return String(binary % 1000000).padStart(6, '0');
}

function verifyTotp(secret, suppliedCode, now = Date.now(), window = 1) {
    if (typeof suppliedCode !== 'string' || !/^\d{6}$/.test(suppliedCode)) return false;
    const counter = Math.floor(now / 30000);
    for (let offset = -window; offset <= window; offset += 1) {
        const expected = Buffer.from(makeTotpCode(secret, counter + offset));
        const supplied = Buffer.from(suppliedCode);
        if (expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied)) return true;
    }
    return false;
}

module.exports = { generateTotpSecret, verifyTotp };
