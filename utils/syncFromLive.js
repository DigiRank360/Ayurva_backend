// Copies public catalog data (categories, products, banners) from the live API
// into the local database so the app shows products in local mode.
// Usage: node utils/syncFromLive.js [liveBaseUrl]
require('dotenv').config();
const mongoose = require('mongoose');

const LIVE = (process.argv[2] || process.env.LIVE_API_URL || 'https://ayuvapro.com').replace(/\/$/, '');

const getJson = async (path) => {
    const res = await fetch(`${LIVE}/api${path}`);
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
};

const upsertAll = async (collection, docs) => {
    for (const doc of docs) {
        const { _id, ...rest } = doc;
        const id = new mongoose.Types.ObjectId(_id);
        await collection.updateOne({ _id: id }, { $set: rest }, { upsert: true });
    }
    return docs.length;
};

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection;

    const categories = await getJson('/categories');
    const banners = await getJson('/banners');
    const first = await getJson('/products?limit=100&page=1');
    let products = first.products || [];
    for (let p = 2; p <= (first.pages || 1); p++) {
        products = products.concat((await getJson(`/products?limit=100&page=${p}`)).products || []);
    }

    const fix = (d) => ({
        ...d,
        ...(d.user ? { user: new mongoose.Types.ObjectId(d.user) } : {}),
        ...(d.createdAt ? { createdAt: new Date(d.createdAt) } : {}),
        ...(d.updatedAt ? { updatedAt: new Date(d.updatedAt) } : {}),
    });

    console.log('categories:', await upsertAll(db.collection('categories'), categories.map(fix)));
    console.log('products:', await upsertAll(db.collection('products'), products.map(fix)));
    console.log('banners:', await upsertAll(db.collection('banners'), banners.map(fix)));
    await mongoose.disconnect();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
