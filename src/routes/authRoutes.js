import express from 'express';
import { register, login, refresh, logout, logoutAll, getSessions } from '../controllers/authController.js';
import { validateRequest } from '../middlewares/validation.js';
import { registerSchema, loginSchema } from '../utils/validators.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import { authenticate } from '../middlewares/auth.js';

const router = express.Router();

router.post('/register', authLimiter, validateRequest(registerSchema), register);
router.post('/login', authLimiter, validateRequest(loginSchema), login);
router.post('/refresh', refresh);
router.post('/logout', authenticate, logout);
router.post('/logout-all', authenticate, logoutAll);
router.get('/sessions', authenticate, getSessions);

export default router;
