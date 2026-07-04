import User from '../models/User.js';
import Team from '../models/Team.js';
import ChallengeSession from '../models/ChallengeSession.js';
import TeamChallenge from '../models/TeamChallenge.js';
import Hackathon from '../models/Hackathon.js';
import mongoose from 'mongoose';
import { emitToGlobal } from '../config/socket.js';

export class LeaderboardService {

  // Update rankings and cache previous rank to display position changes
  static async recalculateUserRankings() {
    const users = await User.find({}).sort({ points: -1, stars: -1, createdAt: 1 }).select('_id ranking');
    
    const bulkOps = users.map((user, index) => {
      const newRank = index + 1;
      const prevRank = user.ranking || 999999;
      return {
        updateOne: {
          filter: { _id: user._id },
          update: {
            $set: {
              ranking: newRank,
              previousRanking: prevRank
            }
          }
        }
      };
    });

    if (bulkOps.length > 0) {
      await User.bulkWrite(bulkOps);
    }
    emitToGlobal('leaderboard:refresh', { type: 'user' });
  }

  static async recalculateTeamRankings() {
    const teams = await Team.find({}).sort({ points: -1, stars: -1, createdAt: 1 }).select('_id ranking');
    
    const bulkOps = teams.map((team, index) => {
      const newRank = index + 1;
      const prevRank = team.ranking || 999999;
      return {
        updateOne: {
          filter: { _id: team._id },
          update: {
            $set: {
              ranking: newRank,
              previousRanking: prevRank
            }
          }
        }
      };
    });

    if (bulkOps.length > 0) {
      await Team.bulkWrite(bulkOps);
    }
    emitToGlobal('leaderboard:refresh', { type: 'team' });
  }

  // Get user leaderboard with ranks, surroundings, and changes
  static async getUserLeaderboard(userId = null, limit = 50, skip = 0) {
    const users = await User.aggregate([
      { $sort: { points: -1, stars: -1 } },
      {
        $project: {
          username: 1,
          points: 1,
          stars: 1,
          ranking: 1,
          previousRanking: 1,
          profilePicture: 1,
          country: 1,
          positionChange: {
            $cond: {
              if: { $or: [{ $eq: ['$previousRanking', 999999] }, { $not: ['$previousRanking'] }] },
              then: 0,
              else: { $subtract: ['$previousRanking', '$ranking'] } // positive means rank improved
            }
          }
        }
      },
      { $skip: skip },
      { $limit: limit }
    ]);

    let surrounding = { currentUserRank: null, above: [], below: [] };

    if (userId) {
      const currentUser = await User.findById(userId);
      if (currentUser) {
        surrounding.currentUserRank = currentUser.ranking;
        
        // Find users directly above (ranks smaller than user ranking)
        surrounding.above = await User.find({ ranking: { $lt: currentUser.ranking, $gte: Math.max(1, currentUser.ranking - 3) } })
          .sort({ ranking: -1 })
          .select('username points stars ranking profilePicture country');

        // Find users directly below (ranks greater than user ranking)
        surrounding.below = await User.find({ ranking: { $gt: currentUser.ranking, $lte: currentUser.ranking + 3 } })
          .sort({ ranking: 1 })
          .select('username points stars ranking profilePicture country');
      }
    }

    return {
      leaderboard: users,
      surrounding
    };
  }

  // Get team leaderboard with ranks, surroundings, and changes
  static async getTeamLeaderboard(teamId = null, limit = 50, skip = 0) {
    const teams = await Team.aggregate([
      { $sort: { points: -1, stars: -1 } },
      {
        $project: {
          name: 1,
          points: 1,
          stars: 1,
          ranking: 1,
          previousRanking: 1,
          positionChange: {
            $cond: {
              if: { $or: [{ $eq: ['$previousRanking', 999999] }, { $not: ['$previousRanking'] }] },
              then: 0,
              else: { $subtract: ['$previousRanking', '$ranking'] }
            }
          }
        }
      },
      { $skip: skip },
      { $limit: limit }
    ]);

    let surrounding = { currentTeamRank: null, above: [], below: [] };

    if (teamId) {
      const currentTeam = await Team.findById(teamId);
      if (currentTeam) {
        surrounding.currentTeamRank = currentTeam.ranking;

        surrounding.above = await Team.find({ ranking: { $lt: currentTeam.ranking, $gte: Math.max(1, currentTeam.ranking - 3) } })
          .sort({ ranking: -1 })
          .select('name points stars ranking');

        surrounding.below = await Team.find({ ranking: { $gt: currentTeam.ranking, $lte: currentTeam.ranking + 3 } })
          .sort({ ranking: 1 })
          .select('name points stars ranking');
      }
    }

    return {
      leaderboard: teams,
      surrounding
    };
  }

  // Aggregation pipeline for Hackathon standings
  static async getHackathonLeaderboard(hackathonId, teamId = null) {
    const hackathon = await Hackathon.findById(hackathonId);
    if (!hackathon) return null;

    // Get all challenge IDs in this hackathon
    const challengeIds = hackathon.challenges;
    
    // Count total questions in the hackathon to measure completion percentage
    const totalQuestionsCountResult = await Hackathon.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(hackathonId) } },
      { $lookup: { from: 'ctfs', localField: 'challenges', foreignField: '_id', as: 'ctfDocs' } },
      { $unwind: '$ctfDocs' },
      { $project: { questionsCount: { $size: '$ctfDocs.questions' } } },
      { $group: { _id: null, total: { $sum: '$questionsCount' } } }
    ]);
    const totalQuestionsCount = totalQuestionsCountResult[0]?.total || 1;

    // Aggregate completed challenge sessions for teams in this hackathon
    const leaderboard = await TeamChallenge.aggregate([
      { 
        $match: { 
          challengeId: { $in: challengeIds }
        } 
      },
      { $unwind: '$solvedQuestions' },
      {
        $group: {
          _id: '$teamId',
          totalPoints: { $sum: '$solvedQuestions.pointsAwarded' },
          totalSolved: { $sum: 1 },
          lastSolveTime: { $max: '$solvedQuestions.solvedAt' }
        }
      },
      // Join team details
      {
        $lookup: {
          from: 'teams',
          localField: '_id',
          foreignField: '_id',
          as: 'teamDetails'
        }
      },
      { $unwind: '$teamDetails' },
      {
        $project: {
          _id: 1,
          teamName: '$teamDetails.name',
          points: '$totalPoints',
          solved: '$totalSolved',
          lastSolveTime: 1,
          stars: '$teamDetails.stars',
          completionPercentage: {
            $multiply: [
              { $divide: ['$totalSolved', totalQuestionsCount] },
              100
            ]
          }
        }
      },
      // Sort by points desc, then lastSolveTime asc
      { $sort: { points: -1, lastSolveTime: 1 } }
    ]);

    // Format scoreboard and inject rank
    const rankedScoreboard = leaderboard.map((item, index) => ({
      rank: index + 1,
      ...item
    }));

    let surrounding = { currentTeamRank: null, above: [], below: [] };

    if (teamId) {
      const matchIndex = rankedScoreboard.findIndex(t => t._id.toString() === teamId.toString());
      if (matchIndex !== -1) {
        const teamRank = matchIndex + 1;
        surrounding.currentTeamRank = teamRank;
        surrounding.above = rankedScoreboard.slice(Math.max(0, matchIndex - 3), matchIndex);
        surrounding.below = rankedScoreboard.slice(matchIndex + 1, matchIndex + 4);
      }
    }

    return {
      leaderboard: rankedScoreboard,
      surrounding
    };
  }
}
