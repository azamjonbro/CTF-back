import mongoose from 'mongoose';
import logger from '../utils/logger.js';

export const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ctf';
  
  try {
    await mongoose.connect(uri, {
      maxPoolSize: 100, // Handle high concurrent user counts (up to 10k users)
      minPoolSize: 10,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000,
    });
    
    logger.info('MongoDB database connection established successfully.');
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
