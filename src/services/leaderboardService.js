import User from '../models/User.js';
import Team from '../models/Team.js';
import ChallengeSession from '../models/ChallengeSession.js';
import TeamChallenge from '../models/TeamChallenge.js';
import Hackathon from '../models/Hackathon.js';
import ChallengeSolve from '../models/ChallengeSolve.js';
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
  static async calculateUserStatsFromDb(userId) {
    const sessions = await ChallengeSession.find({ userId });
    const team = await Team.findOne({ members: userId });
    let teamSessions = [];
    if (team) {
      teamSessions = await TeamChallenge.find({ teamId: team._id });
    }

    const uniqueSolvedQuestions = new Map(); // questionId -> pointsAwarded
    const uniqueSolvedFlags = new Map(); // `${challengeId}_${flagIndex}` -> pointsAwarded

    sessions.forEach(s => {
      if (s.solvedQuestions) {
        s.solvedQuestions.forEach(sq => {
          const qId = sq.questionId.toString();
          if (!uniqueSolvedQuestions.has(qId) || (sq.pointsAwarded || 0) > uniqueSolvedQuestions.get(qId)) {
            uniqueSolvedQuestions.set(qId, sq.pointsAwarded || 0);
          }
        });
      }
      if (s.solvedFlags) {
        s.solvedFlags.forEach(sf => {
          const fKey = `${s.challengeId.toString()}_${sf.flagIndex}`;
          if (!uniqueSolvedFlags.has(fKey) || (sf.pointsAwarded || 0) > uniqueSolvedFlags.get(fKey)) {
            uniqueSolvedFlags.set(fKey, sf.pointsAwarded || 0);
          }
        });
      }
    });

    teamSessions.forEach(ts => {
      if (ts.solvedQuestions) {
        ts.solvedQuestions.forEach(sq => {
          const qId = sq.questionId.toString();
          if (!uniqueSolvedQuestions.has(qId) || (sq.pointsAwarded || 0) > uniqueSolvedQuestions.get(qId)) {
            uniqueSolvedQuestions.set(qId, sq.pointsAwarded || 0);
          }
        });
      }
      if (ts.solvedFlags) {
        ts.solvedFlags.forEach(sf => {
          const fKey = `${ts.challengeId.toString()}_${sf.flagIndex}`;
          if (!uniqueSolvedFlags.has(fKey) || (sf.pointsAwarded || 0) > uniqueSolvedFlags.get(fKey)) {
            uniqueSolvedFlags.set(fKey, sf.pointsAwarded || 0);
          }
        });
      }
    });

    let solvedQuestionsCount = uniqueSolvedQuestions.size;
    let solvedFlagsCount = uniqueSolvedFlags.size;
    let earnedQuestionPoints = 0;
    uniqueSolvedQuestions.forEach(p => { earnedQuestionPoints += p; });
    let earnedFlagPoints = 0;
    uniqueSolvedFlags.forEach(p => { earnedFlagPoints += p; });

    const totalScore = earnedFlagPoints + earnedQuestionPoints;
    const totalSolved = solvedFlagsCount + solvedQuestionsCount;
    const participationCount = team ? team.hackathonsJoined.length : 0;

    return {
      totalScore,
      totalSolved,
      solvedFlagsCount,
      solvedQuestionsCount,
      participationCount
    };
  }

  static async calculateTeamStatsFromDb(teamId) {
    const teamSessions = await TeamChallenge.find({ teamId });

    const uniqueSolvedQuestions = new Map();
    const uniqueSolvedFlags = new Map();

    teamSessions.forEach(ts => {
      if (ts.solvedQuestions) {
        ts.solvedQuestions.forEach(sq => {
          const qId = sq.questionId.toString();
          if (!uniqueSolvedQuestions.has(qId) || (sq.pointsAwarded || 0) > uniqueSolvedQuestions.get(qId)) {
            uniqueSolvedQuestions.set(qId, sq.pointsAwarded || 0);
          }
        });
      }
      if (ts.solvedFlags) {
        ts.solvedFlags.forEach(sf => {
          const fKey = `${ts.challengeId.toString()}_${sf.flagIndex}`;
          if (!uniqueSolvedFlags.has(fKey) || (sf.pointsAwarded || 0) > uniqueSolvedFlags.get(fKey)) {
            uniqueSolvedFlags.set(fKey, sf.pointsAwarded || 0);
          }
        });
      }
    });

    let solvedQuestionsCount = uniqueSolvedQuestions.size;
    let solvedFlagsCount = uniqueSolvedFlags.size;
    let earnedQuestionPoints = 0;
    uniqueSolvedQuestions.forEach(p => { earnedQuestionPoints += p; });
    let earnedFlagPoints = 0;
    uniqueSolvedFlags.forEach(p => { earnedFlagPoints += p; });

    const totalScore = earnedFlagPoints + earnedQuestionPoints;
    const totalSolved = solvedFlagsCount + solvedQuestionsCount;

    return {
      totalScore,
      totalSolved,
      solvedFlagsCount,
      solvedQuestionsCount
    };
  }

  // Update rankings and cache previous rank to display position changes
  static async recalculateUserRankings() {
    const allUsers = await User.find({});
    for (const u of allUsers) {
      const stats = await LeaderboardService.calculateUserStatsFromDb(u._id);
      await User.updateOne(
        { _id: u._id },
        {
          $set: {
            points: stats.totalScore,
            totalScore: stats.totalScore,
            solvedFlagsCount: stats.solvedFlagsCount,
            solvedQuestionsCount: stats.solvedQuestionsCount,
            totalSolved: stats.totalSolved,
            'statistics.pointsEarned': stats.totalScore,
            'statistics.totalSolved': stats.totalSolved,
            'statistics.starsEarned': u.stars
          }
        }
      );
    }

    const users = await User.aggregate([
      {
        $addFields: {
          sortFinishTime: { $ifNull: ['$finishTime', new Date('9999-12-31T23:59:59.999Z')] }
        }
      },
      {
        $sort: { points: -1, sortFinishTime: 1, createdAt: 1 }
      },
      {
        $project: { _id: 1, ranking: 1 }
      }
    ]);
    
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
    const allTeams = await Team.find({});
    for (const t of allTeams) {
      const stats = await LeaderboardService.calculateTeamStatsFromDb(t._id);
      await Team.updateOne(
        { _id: t._id },
        {
          $set: {
            points: stats.totalScore,
            solvedFlagsCount: stats.solvedFlagsCount,
            solvedQuestionsCount: stats.solvedQuestionsCount,
            totalSolved: stats.totalSolved
          }
        }
      );
    }

    const teams = await Team.aggregate([
      {
        $addFields: {
          sortFinishTime: { $ifNull: ['$finishTime', new Date('9999-12-31T23:59:59.999Z')] }
        }
      },
      {
        $sort: { points: -1, sortFinishTime: 1, createdAt: 1 }
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
      {
        $addFields: {
          sortFinishTime: { $ifNull: ['$finishTime', new Date('9999-12-31T23:59:59.999Z')] }
        }
      },
      { $sort: { points: -1, sortFinishTime: 1, createdAt: 1 } },
      {
        $project: {
          username: 1,
          points: 1,
          stars: 1,
          solvedFlagsCount: 1,
          solvedQuestionsCount: 1,
          totalSolved: 1,
          finishTime: 1,
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
        
        surrounding.above = await User.find({ ranking: { $lt: currentUser.ranking, $gte: Math.max(1, currentUser.ranking - 3) } })
          .sort({ ranking: 1 })
          .select('username points stars ranking profilePicture country solvedFlagsCount solvedQuestionsCount totalSolved finishTime');

        // Find users directly below (ranks greater than user ranking)
        surrounding.below = await User.find({ ranking: { $gt: currentUser.ranking, $lte: currentUser.ranking + 3 } })
          .sort({ ranking: 1 })
          .select('username points stars ranking profilePicture country solvedFlagsCount solvedQuestionsCount totalSolved finishTime');
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
      { $sort: { points: -1, sortFinishTime: 1, createdAt: 1 } },
      {
        $project: {
          name: 1,
          points: 1,
          stars: 1,
          solvedFlagsCount: 1,
          solvedQuestionsCount: 1,
          totalSolved: 1,
          finishTime: 1,
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
          .sort({ ranking: 1 })
          .select('name points stars ranking finishTime solvedFlagsCount solvedQuestionsCount totalSolved');
        
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
          .select('name points stars ranking finishTime solvedFlagsCount solvedQuestionsCount totalSolved');

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

  static async getFilteredUserLeaderboard(userId = null, limit = 50, skip = 0, filters = {}) {
    let match = {};
    if (filters.challengeId) {
      match.challengeId = new mongoose.Types.ObjectId(filters.challengeId);
    }
    if (filters.startDate || filters.endDate) {
      match.solvedAt = {};
      if (filters.startDate) {
        match.solvedAt.$gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        match.solvedAt.$lte = new Date(filters.endDate);
      }
    }

    let pipeline = [];
    pipeline.push({ $match: match });

    pipeline.push({
      $lookup: {
        from: 'ctfs',
        localField: 'challengeId',
        foreignField: '_id',
        as: 'challenge'
      }
    });
    pipeline.push({ $unwind: '$challenge' });

    if (filters.category) {
      pipeline.push({ $match: { 'challenge.category': filters.category } });
    }

    if (filters.hackathonId) {
      const hackathon = await Hackathon.findById(filters.hackathonId);
      if (hackathon) {
        const challengeIds = hackathon.challenges.map(id => new mongoose.Types.ObjectId(id));
        pipeline.push({ $match: { 'challengeId': { $in: challengeIds } } });
      } else {
        return { leaderboard: [], surrounding: { currentUserRank: null, above: [], below: [] } };
      }
    }

    pipeline.push({
      $group: {
        _id: '$userId',
        points: { $sum: '$pointsAwarded' },
        stars: { $sum: '$challenge.stars' },
        finishTime: { $max: '$solvedAt' }
      }
    });

    pipeline.push({
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user'
      }
    });
    pipeline.push({ $unwind: '$user' });

    pipeline.push({
      $addFields: {
        sortFinishTime: { $ifNull: ['$finishTime', new Date('9999-12-31T23:59:59.999Z')] }
      }
    });
    pipeline.push({
      $sort: { points: -1, stars: -1, sortFinishTime: 1 }
    });

    let sortedUsers = await ChallengeSolve.aggregate(pipeline);

    sortedUsers = sortedUsers.map((item, idx) => {
      return {
        _id: item._id,
        username: item.user.username,
        profilePicture: item.user.profilePicture,
        country: item.user.country,
        points: item.points,
        stars: item.stars,
        ranking: idx + 1,
        previousRanking: item.user.previousRanking || idx + 1,
        positionChange: 0
      };
    });

    let surrounding = { currentUserRank: null, above: [], below: [] };
    if (userId) {
      const currentIdx = sortedUsers.findIndex(u => u._id.toString() === userId.toString());
      if (currentIdx !== -1) {
        surrounding.currentUserRank = currentIdx + 1;
        surrounding.above = sortedUsers.slice(aboveStart, currentIdx);
        surrounding.below = sortedUsers.slice(currentIdx + 1, currentIdx + 4);
      }
    }

    const paginatedUsers = sortedUsers.slice(skip, skip + limit);

    return {
      leaderboard: paginatedUsers,
      surrounding
    };
  }

  static async getFilteredTeamLeaderboard(teamId = null, limit = 50, skip = 0, filters = {}) {
    let match = {};
    if (filters.challengeId) {
      match.challengeId = new mongoose.Types.ObjectId(filters.challengeId);
    }
    if (filters.startDate || filters.endDate) {
      match.solvedAt = {};
      if (filters.startDate) {
        match.solvedAt.$gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        match.solvedAt.$lte = new Date(filters.endDate);
      }
    }

    let pipeline = [];
    pipeline.push({ $match: { ...match, teamId: { $ne: null } } });

    pipeline.push({
      $lookup: {
        from: 'ctfs',
        localField: 'challengeId',
        foreignField: '_id',
        as: 'challenge'
      }
    });
    pipeline.push({ $unwind: '$challenge' });

    if (filters.category) {
      pipeline.push({ $match: { 'challenge.category': filters.category } });
    }

    if (filters.hackathonId) {
      const hackathon = await Hackathon.findById(filters.hackathonId);
      if (hackathon) {
        const challengeIds = hackathon.challenges.map(id => new mongoose.Types.ObjectId(id));
        pipeline.push({ $match: { 'challengeId': { $in: challengeIds } } });
      } else {
        return { leaderboard: [], surrounding: { currentTeamRank: null, above: [], below: [] } };
      }
    }

    pipeline.push({
      $group: {
        _id: '$teamId',
        points: { $sum: '$pointsAwarded' },
        stars: { $sum: '$challenge.stars' },
        finishTime: { $max: '$solvedAt' }
      }
    });

    pipeline.push({
      $lookup: {
        from: 'teams',
        localField: '_id',
        foreignField: '_id',
        as: 'team'
      }
    });
    pipeline.push({ $unwind: '$team' });

    pipeline.push({
      $addFields: {
        sortFinishTime: { $ifNull: ['$finishTime', new Date('9999-12-31T23:59:59.999Z')] }
      }
    });
    pipeline.push({
      $sort: { points: -1, sortFinishTime: 1, stars: -1 }
    });

    let sortedTeams = await ChallengeSolve.aggregate(pipeline);

    sortedTeams = sortedTeams.map((item, idx) => {
      return {
        _id: item._id,
        name: item.team.name,
        points: item.points,
        stars: item.stars,
        ranking: idx + 1,
        previousRanking: item.team.ranking || idx + 1,
        finishTime: item.finishTime,
        positionChange: 0
      };
    });

    let surrounding = { currentTeamRank: null, above: [], below: [] };
    if (teamId) {
      const currentIdx = sortedTeams.findIndex(t => t._id.toString() === teamId.toString());
      if (currentIdx !== -1) {
        surrounding.currentTeamRank = currentIdx + 1;
        surrounding.above = sortedTeams.slice(aboveStart, currentIdx);
        surrounding.below = sortedTeams.slice(currentIdx + 1, currentIdx + 4);
      }
    }

    const paginatedTeams = sortedTeams.slice(skip, skip + limit);

    return {
      leaderboard: paginatedTeams,
      surrounding
    };
  }
}
