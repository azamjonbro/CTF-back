import Hackathon from '../models/Hackathon.js';
import { emitToGlobal } from '../config/socket.js';
import { LeaderboardService } from './leaderboardService.js';
import logger from '../utils/logger.js';

export class LifecycleService {
  /**
   * Synchronizes the lifecycle status of all hackathons.
   * Transition 'upcoming' to 'active' when start time has passed.
   * Transition 'active' to 'finished' when end time has passed.
   * Automatically emits socket notifications and updates global rankings.
   */
  static async syncHackathonLifecycle() {
    try {
      const now = new Date();
      let modified = false;

      // 1. Transition 'upcoming' to 'active'
      const upcomingToStart = await Hackathon.find({
        status: 'upcoming',
        hackathonStart: { $lte: now }
      });

      if (upcomingToStart.length > 0) {
        for (const h of upcomingToStart) {
          h.status = 'active';
          await h.save();
          logger.info(`Lifecycle Sync: Hackathon [${h.name}] has started.`);
          modified = true;

          // Broadcast real-time socket event globally
          emitToGlobal('hackathon:started', {
            hackathonId: h._id.toString(),
            name: h.name,
            status: 'active',
            hackathonStart: h.hackathonStart,
            hackathonEnd: h.hackathonEnd
          });
        }
      }

      // 2. Transition 'active' to 'finished'
      const activeToFinish = await Hackathon.find({
        status: 'active',
        hackathonEnd: { $lte: now }
      });

      if (activeToFinish.length > 0) {
        for (const h of activeToFinish) {
          h.status = 'finished';
          await h.save();
          logger.info(`Lifecycle Sync: Hackathon [${h.name}] has finished.`);
          modified = true;

          // Broadcast real-time socket event globally
          emitToGlobal('hackathon:finished', {
            hackathonId: h._id.toString(),
            name: h.name,
            status: 'finished',
            hackathonStart: h.hackathonStart,
            hackathonEnd: h.hackathonEnd
          });
        }
      }

      // 3. Recalculate rankings if there were status updates
      if (modified) {
        await LeaderboardService.recalculateUserRankings();
        await LeaderboardService.recalculateTeamRankings();
        emitToGlobal('leaderboard:refresh', {});
      }
    } catch (error) {
      logger.error(`Lifecycle Sync Error: ${error.message}`);
    }
  }
}
