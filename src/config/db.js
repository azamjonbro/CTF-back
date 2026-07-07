import mongoose from 'mongoose';
import logger from '../utils/logger.js';
import User from '../models/User.js';

const seedAdminUser = async () => {
  try {
    const adminEmail = 'superadmin@ctf.com';
    const adminUsername = 'superadmin';
    
    const existingAdmin = await User.findOne({ 
      $or: [{ email: adminEmail }, { username: adminUsername }] 
    });
    
    if (!existingAdmin) {
      const admin = new User({
        username: adminUsername,
        email: adminEmail,
        passwordHash: 'SuperAdminSecurePassword2026!',
        name: 'Super',
        surname: 'Admin',
        roles: ['admin']
      });
      await admin.save();
      logger.info(`Admin user seeded successfully: ${adminEmail}`);
    }
  } catch (error) {
    logger.error(`Error seeding admin user: ${error.message}`);
  }
};

export const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ctf';
  
  try {
    await mongoose.connect(uri, {
      maxPoolSize: 100,
      minPoolSize: 10,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000,
    });
    
    logger.info('MongoDB database connection established successfully.');
    await seedAdminUser();
  } catch (error) {
    logger.error(`MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB connection disconnected. Retrying...');
});

mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB connection state error: ${err.message}`);
});
