const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

dotenv.config();

const resetAdmin = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        console.log('Connected to DB');

        // Delete all existing admins
        const deleteResult = await User.deleteMany({ isAdmin: true });
        console.log('Deleted existing admins. Count:', deleteResult.deletedCount);

        // Create new admin
        const newAdmin = new User({
            name: 'Super Admin',
            email: 'admin@ayurvapro.com',
            password: 'AdminPassword123!',
            phone: '0000000000',
            isAdmin: true
        });

        await newAdmin.save();
        console.log('✅ New admin created successfully.');
        console.log('Email: admin@ayurvapro.com');
        console.log('Password: AdminPassword123!');

        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('Error resetting admin:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
};

resetAdmin();
