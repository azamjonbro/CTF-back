import { LeaderboardService } from '../services/leaderboardService.js';
import Team from '../models/Team.js';

export const getUserLeaderboard = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;
    const userId = req.user ? req.user.userId : null;

    // Dynamically recalculate rankings in real-time to avoid stale placements
    await LeaderboardService.recalculateUserRankings();

    const data = await LeaderboardService.getUserLeaderboard(userId, limit, skip);

    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
};

export const getTeamLeaderboard = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;
    const userId = req.user ? req.user.userId : null;

    // Find the user's team if they belong to one
    let teamId = null;
    if (userId) {
      const team = await Team.findOne({ members: userId });
      if (team) {
        teamId = team._id;
      }
    }

    // Dynamically recalculate rankings in real-time to avoid stale placements
    await LeaderboardService.recalculateTeamRankings();

    const data = await LeaderboardService.getTeamLeaderboard(teamId, limit, skip);

    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
};

export const getLeaderboardAndFinishTime = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;
    const userId = req.user ? req.user.userId : null;

    let teamId = null;
    if (userId) {
      const team = await Team.findOne({ members: userId });
      if (team) {
        teamId = team._id;
      }
    }

    await LeaderboardService.recalculateTeamRankings();
    const data = await LeaderboardService.getTeamLeaderboard(teamId, limit, skip);

    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
};
