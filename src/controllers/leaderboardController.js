import { LeaderboardService } from '../services/leaderboardService.js';
import Team from '../models/Team.js';

export const getUserLeaderboard = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;
    const userId = req.user ? req.user.userId : null;
    const { hackathonId, category, challengeId, startDate, endDate } = req.query;

    let data;
    if (hackathonId || category || challengeId || startDate || endDate) {
      data = await LeaderboardService.getFilteredUserLeaderboard(userId, limit, skip, {
        hackathonId,
        category,
        challengeId,
        startDate,
        endDate
      });
    } else {
      await LeaderboardService.recalculateUserRankings();
      data = await LeaderboardService.getUserLeaderboard(userId, limit, skip);
    }

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
    const { hackathonId, category, challengeId, startDate, endDate } = req.query;

    let teamId = null;
    if (userId) {
      const team = await Team.findOne({ members: userId });
      if (team) {
        teamId = team._id;
      }
    }

    let data;
    if (hackathonId || category || challengeId || startDate || endDate) {
      data = await LeaderboardService.getFilteredTeamLeaderboard(teamId, limit, skip, {
        hackathonId,
        category,
        challengeId,
        startDate,
        endDate
      });
    } else {
      await LeaderboardService.recalculateTeamRankings();
      data = await LeaderboardService.getTeamLeaderboard(teamId, limit, skip);
    }

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
    const { hackathonId, category, challengeId, startDate, endDate } = req.query;

    let teamId = null;
    if (userId) {
      const team = await Team.findOne({ members: userId });
      if (team) {
        teamId = team._id;
      }
    }

    let data;
    if (hackathonId || category || challengeId || startDate || endDate) {
      data = await LeaderboardService.getFilteredTeamLeaderboard(teamId, limit, skip, {
        hackathonId,
        category,
        challengeId,
        startDate,
        endDate
      });
    } else {
      await LeaderboardService.recalculateTeamRankings();
      data = await LeaderboardService.getTeamLeaderboard(teamId, limit, skip);
    }

    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
};
