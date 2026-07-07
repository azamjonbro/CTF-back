import User from '../models/User.js';
import Team from '../models/Team.js';
import ChallengeSession from '../models/ChallengeSession.js';
import TeamChallenge from '../models/TeamChallenge.js';
import Hackathon from '../models/Hackathon.js';
import mongoose from 'mongoose';
import { emitToGlobal } from '../config/socket.js';

export class LeaderboardService {

  static formatDuration(ms) {
    if (!ms || ms < 0) return '00:00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      seconds.toString().padStart(2, '0')
    ].join(':');
  }

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
    const teams = await Team.aggregate([
      {
        $addFields: {
          sortFinishTime: { $ifNull: ['$finishTime', new Date('9999-12-31T23:59:59.999Z')] }
        }
      },
      {
        $sort: { points: -1, sortFinishTime: 1, stars: -1, createdAt: 1 }
      },
      {
        $project: { _id: 1, ranking: 1 }
      }
    ]);
    
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
    const activeHackathon = await Hackathon.findOne({ status: 'active' });
    const teams = await Team.aggregate([
      {
        $addFields: {
          sortFinishTime: { $ifNull: ['$finishTime', new Date('9999-12-31T23:59:59.999Z')] }
        }
      },
      { $sort: { points: -1, sortFinishTime: 1, stars: -1 } },
      {
        $project: {
          name: 1,
          points: 1,
          stars: 1,
          ranking: 1,
          previousRanking: 1,
          finishTime: 1,
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

    const formattedTeams = teams.map((t) => {
      let formattedFinishTime = '—';
      if (t.finishTime && activeHackathon) {
        const elapsedMs = new Date(t.finishTime).getTime() - activeHackathon.hackathonStart.getTime();
        formattedFinishTime = LeaderboardService.formatDuration(elapsedMs);
      }
      return {
        ...t,
        finishTime: formattedFinishTime
      };
    });

    let surrounding = { currentTeamRank: null, above: [], below: [] };

    if (teamId) {
      const currentTeam = await Team.findById(teamId);
      if (currentTeam) {
        surrounding.currentTeamRank = currentTeam.ranking;

        const rawAbove = await Team.find({ ranking: { $lt: currentTeam.ranking, $gte: Math.max(1, currentTeam.ranking - 3) } })
          .sort({ ranking: -1 })
          .select('name points stars ranking finishTime');
        
        surrounding.above = rawAbove.map(a => {
          let formattedFinishTime = '—';
          if (a.finishTime && activeHackathon) {
            const elapsedMs = new Date(a.finishTime).getTime() - activeHackathon.hackathonStart.getTime();
            formattedFinishTime = LeaderboardService.formatDuration(elapsedMs);
          }
          return {
            ...a.toObject(),
            finishTime: formattedFinishTime
          };
        });

        const rawBelow = await Team.find({ ranking: { $gt: currentTeam.ranking, $lte: currentTeam.ranking + 3 } })
          .sort({ ranking: 1 })
          .select('name points stars ranking finishTime');

        surrounding.below = rawBelow.map(b => {
          let formattedFinishTime = '—';
          if (b.finishTime && activeHackathon) {
            const elapsedMs = new Date(b.finishTime).getTime() - activeHackathon.hackathonStart.getTime();
            formattedFinishTime = LeaderboardService.formatDuration(elapsedMs);
          }
          return {
            ...b.toObject(),
            finishTime: formattedFinishTime
          };
        });
      }
    }

    return {
      leaderboard: formattedTeams,
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
      {
        $project: {
          teamId: 1,
          sessionPoints: {
            $add: [
              { $sum: { $ifNull: ['$solvedQuestions.pointsAwarded', [0]] } },
              { $sum: { $ifNull: ['$solvedFlags.pointsAwarded', [0]] } }
            ]
          },
          sessionSolvedCount: { $size: { $ifNull: ['$solvedQuestions', []] } },
          sessionLastSolveTime: {
            $cond: {
              if: { $gt: [{ $size: { $ifNull: ['$solvedQuestions', []] } }, 0] },
              then: { $max: '$solvedQuestions.solvedAt' },
              else: null
            }
          },
          sessionLastFlagTime: {
            $cond: {
              if: { $gt: [{ $size: { $ifNull: ['$solvedFlags', []] } }, 0] },
              then: { $max: '$solvedFlags.solvedAt' },
              else: null
            }
          }
        }
      },
      {
        $project: {
          teamId: 1,
          sessionPoints: 1,
          sessionSolvedCount: 1,
          sessionLastSolveTime: {
            $cond: {
              if: { $and: [ { $ifNull: ['$sessionLastSolveTime', false] }, { $ifNull: ['$sessionLastFlagTime', false] } ] },
              then: { $max: ['$sessionLastSolveTime', '$sessionLastFlagTime'] },
              else: { $ifNull: ['$sessionLastSolveTime', '$sessionLastFlagTime'] }
            }
          }
        }
      },
      {
        $group: {
          _id: '$teamId',
          totalPoints: { $sum: '$sessionPoints' },
          totalSolved: { $sum: '$sessionSolvedCount' },
          lastSolveTime: { $max: '$sessionLastSolveTime' }
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
          finishTime: '$teamDetails.finishTime',
          completionPercentage: {
            $multiply: [
              { $divide: ['$totalSolved', totalQuestionsCount] },
              100
            ]
          }
        }
      },
      // Sort by points desc, then finishTime asc
      {
        $addFields: {
          sortFinishTime: { $ifNull: ['$finishTime', new Date('9999-12-31T23:59:59.999Z')] }
        }
      },
      { $sort: { points: -1, sortFinishTime: 1 } }
    ]);

    // Format scoreboard and inject rank
    const rankedScoreboard = leaderboard.map((item, index) => {
      let formattedFinishTime = '—';
      if (item.finishTime) {
        const elapsedMs = new Date(item.finishTime).getTime() - hackathon.hackathonStart.getTime();
        formattedFinishTime = LeaderboardService.formatDuration(elapsedMs);
      }
      return {
        rank: index + 1,
        ...item,
        finishTime: formattedFinishTime
      };
    });

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

  static async updateTeamFinishTime(teamId, hackathonId) {
    const hackathon = await Hackathon.findById(hackathonId);
    if (!hackathon) return;

    const challengeIds = hackathon.challenges;
    if (!challengeIds || challengeIds.length === 0) return;

    // Find all TeamChallenge documents for this team and these challenges
    const sessions = await TeamChallenge.find({
      teamId,
      challengeId: { $in: challengeIds }
    });

    // Check if every challenge in the hackathon has a completed session
    const allCompleted = challengeIds.every(cId => {
      const session = sessions.find(s => s.challengeId.toString() === cId.toString());
      return session && session.status === 'completed';
    });

    if (allCompleted) {
      let maxTime = hackathon.hackathonStart;
      sessions.forEach(s => {
        if (s.updatedAt && s.updatedAt > maxTime) {
          maxTime = s.updatedAt;
        }
      });
      await Team.findByIdAndUpdate(teamId, { finishTime: maxTime });
    } else {
      await Team.findByIdAndUpdate(teamId, { $unset: { finishTime: 1 } });
    }
  }
}
