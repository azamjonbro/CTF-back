import express from 'express';
import { getUserLeaderboard, getTeamLeaderboard } from '../controllers/leaderboardController.js';
import { authenticate } from '../middlewares/auth.js';

const router = express.Router();

// Optional authenticate middleware lets us fetch current user context rankings if logged in
const optionalAuthenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticate(req, res, next);
  }
  next();
};

router.get('/users', optionalAuthenticate, getUserLeaderboard);
router.get('/teams', optionalAuthenticate, getTeamLeaderboard);

export default router;
