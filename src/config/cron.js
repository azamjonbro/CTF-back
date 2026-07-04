import cron from 'node-cron';
import logger from '../utils/logger.js';
import { LeaderboardService } from '../services/leaderboardService.js';
import Hackathon from '../models/Hackathon.js';
import ChallengeSession from '../models/ChallengeSession.js';
import { emitToTeam } from './socket.js';
import { LifecycleService } from '../services/lifecycleService.js';

export const initCronJobs = () => {
  // Job 1: Hourly global rank calculation fallback (runs at minute 0)
  cron.schedule('0 * * * *', async () => {
    logger.info('Cron Action: recalculating global leaderboard positions');
    try {
      await LeaderboardService.recalculateUserRankings();
      await LeaderboardService.recalculateTeamRankings();
      logger.info('Cron Action: global leaderboard rankings updated successfully');
    } catch (error) {
      logger.error(`Cron error during leaderboard update: ${error.message}`);
    }
  });

  // Job 2: Hackathon Status Updates (runs every minute)
  cron.schedule('* * * * *', async () => {
    logger.info('Cron Action: Checking and updating hackathon lifecycles...');
    await LifecycleService.syncHackathonLifecycle();
  });

  // Job 3: Expired Challenge Sessions check (runs every minute)
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const expiredSessions = await ChallengeSession.find({
        status: 'active',
        expiresAt: { $lte: now }
      });

      if (expiredSessions.length > 0) {
        for (const session of expiredSessions) {
          session.status = 'expired';
          await session.save();
          
          logger.info(`Cron: Challenge Session [${session._id}] for team [${session.teamId}] has expired.`);
          
          // Emit socket notification to the team
          emitToTeam(session.teamId.toString(), 'timer:expired', {
            challengeId: session.challengeId,
            message: 'Your challenge time limit has expired!'
          });
        }
      }
    } catch (error) {
      logger.error(`Cron error during session expiry check: ${error.message}`);
    }
  });

  logger.info('Background cron schedulers registered.');
};
