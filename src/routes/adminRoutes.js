import express from 'express';
import { getDashboardStats, createHackathon, manageRoles, getAuditLogs, getHackathonStats, editHackathon, deleteHackathon, getResetInfo, performReset } from '../controllers/adminController.js';
import { authenticate, requireRole } from '../middlewares/auth.js';
import { validateRequest } from '../middlewares/validation.js';
import { hackathonCreateSchema, hackathonUpdateSchema, manageRolesSchema } from '../utils/validators.js';

const router = express.Router();

// All routes require Admin credentials
router.use(authenticate, requireRole(['admin']));

router.get('/stats', getDashboardStats);
router.post('/hackathons', validateRequest(hackathonCreateSchema), createHackathon);
router.put('/hackathons/:hackathonId', validateRequest(hackathonUpdateSchema), editHackathon);
router.delete('/hackathons/:hackathonId', deleteHackathon);
router.post('/roles', validateRequest(manageRolesSchema), manageRoles);
router.get('/logs', getAuditLogs);
router.get('/hackathons/:hackathonId/stats', getHackathonStats);
router.get('/reset/info', getResetInfo);
router.post('/reset', performReset);

export default router;
