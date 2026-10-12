const multer = require('multer');

const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);

const uploadKycDocuments = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 3 * 1024 * 1024, files: 2 },
    fileFilter: (req, file, callback) => {
        if (!allowedTypes.has(file.mimetype)) {
            return callback(new Error('KYC files must be PDF, JPEG, or PNG, up to 3 MB each.'));
        }
        callback(null, true);
    },
}).fields([
    { name: 'panDocument', maxCount: 1 },
    { name: 'identityDocument', maxCount: 1 },
]);

module.exports = uploadKycDocuments;