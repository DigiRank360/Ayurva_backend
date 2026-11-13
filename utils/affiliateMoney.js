const mongoose = require('mongoose');

function toMinorUnits(value) {
    const text = value instanceof mongoose.Types.Decimal128 ? value.toString() : String(value);
    const match = text.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
    if (!match) throw new TypeError('Money must be a decimal value with at most two fractional digits.');
    const fraction = (match[3] || '').padEnd(2, '0');
    const amount = BigInt(match[2]) * 100n + BigInt(fraction || '0');
    return Number(match[1] === '-' ? -amount : amount);
}

function fromMinorUnits(value) {
    if (!Number.isSafeInteger(value)) throw new TypeError('Money minor units must be a safe integer.');
    const negative = value < 0;
    const absolute = BigInt(Math.abs(value));
    const text = `${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
    return mongoose.Types.Decimal128.fromString(negative ? `-${text}` : text);
}

function percentageOfMinorUnits(amountMinor, percentage) {
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
        throw new TypeError('Commission base must be a non-negative minor-unit integer.');
    }
    const rate = String(percentage);
    const match = rate.match(/^(\d{1,3})(?:\.(\d{1,2}))?$/);
    if (!match) throw new TypeError('Percentage must be between 0 and 100 with at most two decimals.');
    const basisPoints = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0') || 0);
    if (basisPoints > 10000) throw new RangeError('Percentage cannot exceed 100.');
    return Number((BigInt(amountMinor) * BigInt(basisPoints) + 5000n) / 10000n);
}

module.exports = { fromMinorUnits, percentageOfMinorUnits, toMinorUnits };
