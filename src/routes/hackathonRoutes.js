import express from 'express';
import { getHackathons, getHackathonDetails, getHackathonChallenges, getHackathonStandings, getNews, getHackathonRegisteredTeams } from '../controllers/hackathonController.js';
import { authenticate, optionalAuthenticate } from '../middlewares/auth.js';

const router = express.Router();

// Public routes
router.get('/', getHackathons);
router.get('/news', getNews);
router.get('/:hackathonId', getHackathonDetails);
router.get('/:hackathonId/standings', optionalAuthenticate, getHackathonStandings);
router.get('/:hackathonId/registered-teams', getHackathonRegisteredTeams);

// Protected routes (team registered verification happens inside controller)
router.get('/:hackathonId/challenges', authenticate, getHackathonChallenges);

export default router;
