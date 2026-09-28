
const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim();
if (cloudinaryUrl?.startsWith('CLOUDINARY_URL=')) {
    process.env.CLOUDINARY_URL = cloudinaryUrl.slice('CLOUDINARY_URL='.length);
}

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const fs = require('fs');
const path = require('path');

// Configure cloudinary
const hasCloudinaryConfig = Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure storage
const storage = hasCloudinaryConfig
    ? new CloudinaryStorage({
        cloudinary,
        params: {
            folder: 'ayurva-pro/products',
            allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
            transformation: [{ width: 1000, height: 1000, crop: 'limit' }]
        }
    })
    : (() => {
        const multer = require('multer');
        const uploadDirectory = path.join(__dirname, '..', 'uploads');
        fs.mkdirSync(uploadDirectory, { recursive: true });

        return multer.diskStorage({
            destination: uploadDirectory,
            filename: (req, file, callback) => {
                const extension = path.extname(file.originalname).toLowerCase();
                callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
            }
        });
    })();

module.exports = { cloudinary, storage };
