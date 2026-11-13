
// Global error handler middleware
const errorHandler = (err, req, res, next) => {
    const multerStatus = err.name === 'MulterError'
        ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        : null;
    const statusCode = err.statusCode || multerStatus || (err.code === 11000 ? 409 : (res.statusCode === 200 ? 500 : res.statusCode));
    res.status(statusCode);
    res.json({
        message: err.code === 11000
            ? 'A record with the supplied unique value already exists.'
            : err.message,
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
