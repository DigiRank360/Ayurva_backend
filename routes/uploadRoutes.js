
const express = require('express');
const router = express.Router();
const upload = require('../middleware/uploadMiddleware');
const { protect, admin } = require('../middleware/authMiddleware');
const path = require('path');

const getImageUrl = (file) => {
    if (file.path.startsWith('http://') || file.path.startsWith('https://')) {
        return file.path;
    }

    return `/uploads/${path.basename(file.path)}`;
};

// @desc    Upload single image
// @route   POST /api/upload
// @access  Private/Admin
router.post('/', protect, admin, upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        res.json({
            message: 'Image uploaded successfully',
            imageUrl: getImageUrl(req.file),
            publicId: req.file.filename
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @desc    Upload multiple images
// @route   POST /api/upload/multiple
// @access  Private/Admin
router.post('/multiple', protect, admin, upload.array('images', 5), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No files uploaded' });
        }

        const imageUrls = req.files.map(getImageUrl);

        res.json({
            message: `${req.files.length} images uploaded successfully`,
            imageUrls
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.use((error, req, res, next) => {
    if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Image must be smaller than 5 MB' });
    }

    if (error.message === 'Only image files are allowed (jpeg, jpg, png, gif, webp)') {
        return res.status(400).json({ message: error.message });
    }

    next(error);
});

module.exports = router;
