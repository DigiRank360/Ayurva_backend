
const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler'); // Need to install this or use try-catch
const User = require('../models/User');

function getRequestToken(req) {
    const authorization = req.headers.authorization;
    const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    return bearerToken || req.cookies?.jwt;
}

const protect = async (req, res, next) => {
    const token = getRequestToken(req);

    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            req.user = await User.findById(decoded.id).select('-password');

            next();
        } catch (error) {
            console.error(error);
            res.status(401);
            res.json({ message: 'Not authorized, token failed' });
        }
    } else {
        res.status(401);
        res.json({ message: 'Not authorized, no token' });
    }
};

const admin = (req, res, next) => {
    if (req.user && req.user.isAdmin) {
        next();
    } else {
        res.status(401);
        res.json({ message: 'Not authorized as an admin' });
    }
};

module.exports = { protect, admin, getRequestToken };
