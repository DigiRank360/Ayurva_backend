
const mongoose = require('mongoose');

const productSchema = mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    sku: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    subtitle: { type: String, default: '' },
    shortDescription: { type: String, default: '' },
    packSize: { type: String, default: '' },
    featuredTag: { type: String, default: '' },
    images: [{ type: String }],
    categoryId: { type: String, required: true },
    categoryName: { type: String },
    description: { type: String, required: true },
    ingredients: [{ type: String }],
    benefits: [{ type: String }],
    keyPoints: [{ type: String }],
    additionalSections: [{
        title: { type: String, required: true },
        content: { type: String, required: true }
    }],
    reviewCount: { type: Number, default: 12 },
    rating: { type: Number, default: 4.5 },
    mrp: { type: Number, default: 0 },
    price: { type: Number, required: true, default: 0 },
    discount: { type: Number, default: 0 },
    availableSizes: [{ type: String }],
    availableColors: [{ type: String }],
    stock: {
        type: Number,
        required: true,
        default: 0
    },
    inStock: {
        type: Boolean,
        default: true
    },
    isTrending: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isCODAvailable: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);
