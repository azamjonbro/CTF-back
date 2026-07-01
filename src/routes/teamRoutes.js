import express from 'express';
import { createTeam, joinTeam, getMyTeam, registerForHackathon, leaveTeam } from '../controllers/teamController.js';
import { authenticate } from '../middlewares/auth.js';
import { validateRequest } from '../middlewares/validation.js';
import { teamCreateSchema, teamInviteSchema } from '../utils/validators.js';
import { syncHackathonStatuses } from '../middlewares/hackathonSync.js';

const router = express.Router();

router.post('/', authenticate, validateRequest(teamCreateSchema), createTeam);
router.post('/join', authenticate, validateRequest(teamInviteSchema), joinTeam);
router.get('/me', authenticate, getMyTeam);
router.post('/leave', authenticate, leaveTeam);
router.post('/register-hackathon/:hackathonId', authenticate, syncHackathonStatuses, registerForHackathon);

export default router;
