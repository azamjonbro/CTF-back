import express from 'express';
import { getChallenges, getChallengeDetails, startChallengeSession, submitQuestionAnswer, submitChallengeFlag, finishChallenge } from '../controllers/ctfController.js';
import { createChallenge, editChallenge, toggleChallengeStatus, deleteChallenge } from '../controllers/staffController.js';
import { addQuestionToChallenge, uploadAttachment } from '../controllers/supportController.js';
import { authenticate, requireRole, requireTeam } from '../middlewares/auth.js';
import { validateRequest } from '../middlewares/validation.js';
import { ctfCreateSchema, submitAnswerSchema, submitFlagSchema } from '../utils/validators.js';
import { upload } from '../middlewares/upload.js';

const router = express.Router();

// PLAYER ROUTES (Require team participation)
router.get('/', authenticate, getChallenges);
router.get('/:challengeId', authenticate, getChallengeDetails);
router.post('/:challengeId/session', authenticate, requireTeam, startChallengeSession);
router.post('/:challengeId/questions/:questionId/submit', authenticate, validateRequest(submitAnswerSchema), requireTeam, submitQuestionAnswer);
router.post('/:challengeId/flags/:flagIndex/submit', authenticate, validateRequest(submitFlagSchema), requireTeam, submitChallengeFlag);
router.post('/:challengeId/finish', authenticate, requireTeam, finishChallenge);

// STAFF ROUTES (Challenge Management)
router.post('/', authenticate, requireRole(['admin', 'staff']), validateRequest(ctfCreateSchema), createChallenge);
router.put('/:challengeId', authenticate, requireRole(['admin', 'staff']), editChallenge);
router.put('/:challengeId/status', authenticate, requireRole(['admin', 'staff']), toggleChallengeStatus);
router.delete('/:challengeId', authenticate, requireRole(['admin', 'staff']), deleteChallenge);

// SUPPORT ROUTES (Challenge Extension & Uploads)
router.post('/:challengeId/questions', authenticate, requireRole(['admin', 'staff', 'support']), addQuestionToChallenge);
router.post('/upload', authenticate, upload.single('file'), uploadAttachment);

export default router;
