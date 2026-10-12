
// Global error handler middleware
const errorHandler = (err, req, res, next) => {
    const statusCode = err.statusCode || (err.code === 11000 ? 409 : (res.statusCode === 200 ? 500 : res.statusCode));
    res.status(statusCode);
    res.json({
        message: err.code === 11000 ? 'An account already uses that email or phone number. Sign in or use different details.' : err.message,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    });
};

// Not found handler
const notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    res.status(404);
    next(error);
};

module.exports = { errorHandler, notFound };
