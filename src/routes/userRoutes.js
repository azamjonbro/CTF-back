import express from 'express';
import { getProfile, getPublicProfile, updateProfile, getActivityCalendar, getDashboardStats } from '../controllers/userController.js';
import { authenticate, optionalAuthenticate } from '../middlewares/auth.js';

const router = express.Router();

router.get('/profile', authenticate, getProfile);
router.get('/dashboard-stats', authenticate, getDashboardStats);
router.get('/profile/:username', getPublicProfile);
router.put('/profile', authenticate, updateProfile);
router.get('/activity-calendar', optionalAuthenticate, getActivityCalendar);

export default router;
