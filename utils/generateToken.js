
const jwt = require('jsonwebtoken');

const generateToken = (id, claims = {}) => {
    const { expiresIn = '30d', ...additionalClaims } = claims;
    return jwt.sign({ id, ...additionalClaims }, process.env.JWT_SECRET, { expiresIn });
};

module.exports = generateToken;
