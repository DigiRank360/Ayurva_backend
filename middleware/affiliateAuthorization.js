const ROLE_NAMES = [
    'customer',
    'affiliate_partner',
    'support_agent',
    'doctor',
    'finance_operator',
    'affiliate_manager',
    'super_admin',
];

function requireAffiliateRoles(...allowedRoles) {
    return (req, res, next) => {
        const roles = new Set(req.user?.roles || []);
        if (req.user?.isAdmin) roles.add('super_admin');

        const matchedRole = allowedRoles.find((role) => roles.has(role));
        if (!req.user || !matchedRole) {
            return res.status(403).json({ message: 'You do not have permission to perform this action.' });
        }
        if (!['customer', 'affiliate_partner'].includes(matchedRole) && req.auth?.mfaVerified !== true) {
            return res.status(403).json({ message: 'Privileged access requires a verified MFA session.' });
        }
        return next();
    };
}

function optionalProtect(req, res, next) {
    const { getRequestToken } = require('./authMiddleware');
    const jwt = require('jsonwebtoken');
    const User = require('../models/User');
    const token = getRequestToken(req);
    if (!token) return next();
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return User.findById(decoded.id).select('-password').then((user) => {
            if (!user || (user.accountStatus && user.accountStatus !== 'ACTIVE')) {
                return res.status(401).json({ message: 'Not authorized.' });
            }
            req.user = user;
            req.auth = decoded;
            return next();
        }).catch(next);
    } catch (error) {
        return res.status(401).json({ message: 'Not authorized, token failed.' });
    }
}

module.exports = { ROLE_NAMES, optionalProtect, requireAffiliateRoles };
