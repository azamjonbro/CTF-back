import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';

// Setup __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from backend/.env
dotenv.config({ path: path.join(__dirname, '../../.env') });

const resetDb = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ctf';
  console.log(`Connecting to MongoDB at: ${uri}`);
  
  try {
    await mongoose.connect(uri);
    console.log('Connected to MongoDB.');
    
    // Drop the database
    console.log('Dropping database...');
    await mongoose.connection.dropDatabase();
    console.log('Database dropped successfully.');
    
    // Create new superadmin
    console.log('Seeding new superadmin user...');
    const superadmin = new User({
      username: 'superadmin',
      email: 'superadmin@ctf.com',
      passwordHash: 'SuperAdminSecurePassword2026!',
      name: 'Super',
      surname: 'Admin',
      roles: ['admin']
    });
    
    await superadmin.save();
    console.log('Superadmin user created successfully:');
    console.log('  Username: superadmin');
    console.log('  Email: superadmin@ctf.com');
    console.log('  Password: SuperAdminSecurePassword2026!');
    
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB. Done.');
    process.exit(0);
  } catch (error) {
    console.error('Error resetting database:', error);
    process.exit(1);
  }
};

resetDb();
