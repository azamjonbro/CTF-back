import User from '../models/User.js';
import Team from '../models/Team.js';
import CTF from '../models/CTF.js';
import Hackathon from '../models/Hackathon.js';
import News from '../models/News.js';
import AuditLog from '../models/AuditLog.js';
import ChallengeSession from '../models/ChallengeSession.js';
import TeamChallenge from '../models/TeamChallenge.js';
import ChallengeSolve from '../models/ChallengeSolve.js';
import { AppError, ErrorCatalog } from '../utils/errors.js';
import bcrypt from 'bcryptjs';
import { LeaderboardService } from '../services/leaderboardService.js';
import { LifecycleService } from '../services/lifecycleService.js';

// Get Admin System Dashboard Statistics
export const getDashboardStats = async (req, res, next) => {
  try {
    const totalUsers = await User.countDocuments({});
    const totalTeams = await Team.countDocuments({});
    const totalCTFs = await CTF.countDocuments({});
    const totalHackathons = await Hackathon.countDocuments({});

    // User registrations by day (velocity) - last 14 days
    const registrationVelocity = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Challenge breakdown by category
    const categoryStats = await CTF.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          avgStars: { $avg: '$stars' }
        }
      }
    ]);

    // Staff creation performance (how many challenges each staff has authored)
    const staffPerformance = await CTF.aggregate([
      {
        $group: {
          _id: '$author',
          challengesCreated: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'authorDetails'
        }
      },
      { $unwind: '$authorDetails' },
      {
        $project: {
          username: '$authorDetails.username',
          challengesCreated: 1
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        counts: {
          users: totalUsers,
          teams: totalTeams,
          ctfs: totalCTFs,
          hackathons: totalHackathons
        },
        registrationVelocity,
        categoryStats,
        staffPerformance
      }
    });
  } catch (error) {
    next(error);
  }
};

// Create a new Hackathon and auto-generate News item
export const createHackathon = async (req, res, next) => {
  try {
    const { name, description, banner, coverImage, hackathonStart, hackathonEnd, maxTeams, challenges } = req.body;

    if (new Date(hackathonEnd) <= new Date(hackathonStart)) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Xakaton yakunlanish vaqti boshlanish vaqtidan keyin bo\'lishi kerak.');
    }

    const existing = await Hackathon.findOne({ name });
    if (existing) {
      throw new AppError(ErrorCatalog.HACKATHON_MAX_TEAMS_REACHED, 'Hackathon name already exists');
    }

    if (challenges && challenges.length > 0) {
      const otherHackathons = await Hackathon.find({ challenges: { $in: challenges } });
      if (otherHackathons.length > 0) {
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Bitta topshiriq faqat bitta xakatonga bog\'lanishi mumkin.');
      }
    }

    const hackathon = new Hackathon({
      name,
      description,
      banner,
      coverImage,
      hackathonStart,
      hackathonEnd,
      maxTeams,
      challenges: challenges || [],
      status: 'upcoming'
    });

    await hackathon.save();
    await LifecycleService.syncHackathonLifecycle();

    // Auto-create news announcement
    const news = new News({
      hackathonId: hackathon._id,
      title: `New Hackathon Announced: ${name}!`,
      content: `Registration is open for the upcoming hackathon! Run duration: ${new Date(hackathonStart).toLocaleDateString()} to ${new Date(hackathonEnd).toLocaleDateString()}. Register your team now!`,
      type: 'hackathon'
    });
    await news.save();

    // Log action
    await AuditLog.create({
      userId: req.user.userId,
      action: 'CREATE_HACKATHON',
      status: 'success',
      details: { hackathonName: name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(201).json({
      success: true,
      message: 'Hackathon created and announcement news published successfully.',
      data: hackathon
    });
  } catch (error) {
    next(error);
  }
};

// Manage Staff and Support Permissions (Role assigner)
export const manageRoles = async (req, res, next) => {
  try {
    const { targetUserId, action, role } = req.body; // action: 'add' | 'remove', role: 'admin' | 'staff' | 'support' | etc.

    if (!['admin', 'staff', 'support', 'team_leader', 'team_member'].includes(role)) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Invalid role assignment');
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      throw new AppError(ErrorCatalog.USER_NOT_FOUND);
    }

    if (action === 'add') {
      targetUser.roles.push(role);
      // Remove duplicate roles
      targetUser.roles = [...new Set(targetUser.roles)];
    } else if (action === 'remove') {
      targetUser.roles = targetUser.roles.filter(r => r !== role);
      // Ensure users always have at least 'team_member' role
      if (targetUser.roles.length === 0) {
        targetUser.roles.push('team_member');
      }
    }

    await targetUser.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: 'ROLE_MANAGE',
      status: 'success',
      details: { targetUser: targetUser.username, action, role },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: `Role ${role} successfully ${action}ed for user ${targetUser.username}.`,
      data: {
        userId: targetUser._id,
        username: targetUser.username,
        roles: targetUser.roles
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get audit logs for logs viewer
export const getAuditLogs = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const skip = parseInt(req.query.skip) || 0;

    const logs = await AuditLog.find({})
      .populate('userId', 'username email')
      .populate('teamId', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      success: true,
      data: logs
    });
  } catch (error) {
    next(error);
  }
};

// Get detailed stats of a specific hackathon for monitoring/analytics
export const getHackathonStats = async (req, res, next) => {
  try {
    const { hackathonId } = req.params;

    const hackathon = await Hackathon.findById(hackathonId);
    if (!hackathon) {
      throw new AppError(ErrorCatalog.HACKATHON_NOT_FOUND);
    }

    const challengeIds = hackathon.challenges;

    // 1. Get Hackathon Leaderboard
    const leaderboardData = await LeaderboardService.getHackathonLeaderboard(hackathonId);
    const leaderboard = leaderboardData ? leaderboardData.leaderboard : [];

    // 2. Get Active Sessions (what teams are working on right now)
    const activeSessions = await ChallengeSession.find({
      challengeId: { $in: challengeIds },
      status: 'active'
    })
    .populate('teamId', 'name')
    .populate('challengeId', 'title');

    const formattedSessions = activeSessions.map(session => ({
      teamName: session.teamId?.name || 'Unknown Team',
      challengeTitle: session.challengeId?.title || 'Unknown Challenge',
      openedAt: session.openedAt,
      expiresAt: session.expiresAt,
      timeRemainingSeconds: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000))
    }));

    // 3. Get User Solves (AuditLog for SUBMIT_FLAG_SUCCESS of these challenges)
    const userSolves = await AuditLog.find({
      action: 'SUBMIT_FLAG_SUCCESS',
      'details.challengeId': { $in: challengeIds }
    })
    .populate('userId', 'username')
    .populate('teamId', 'name')
    .sort({ createdAt: -1 });

    const challenges = await CTF.find({ _id: { $in: challengeIds } }).select('title questions');
    const challengeMap = {};
    for (const c of challenges) {
      challengeMap[c._id.toString()] = {
        title: c.title,
        questions: c.questions.reduce((acc, q) => {
          acc[q._id.toString()] = q.title;
          return acc;
        }, {})
      };
    }

    const formattedSolves = userSolves.map(log => {
      const cId = log.details?.challengeId?.toString();
      const qId = log.details?.questionId?.toString();
      const challengeInfo = challengeMap[cId] || { title: 'Unknown Challenge', questions: {} };
      const challengeTitle = challengeInfo.title;
      const questionTitle = challengeInfo.questions[qId] || 'Unknown Question';

      return {
        _id: log._id,
        timestamp: log.createdAt,
        username: log.userId?.username || 'Unknown Player',
        teamName: log.teamId?.name || 'Unknown Team',
        challengeTitle,
        questionTitle,
        points: log.details?.scoreAwarded || 0,
        hintsUsed: log.details?.hintsUsed || 0
      };
    });

    res.status(200).json({
      success: true,
      data: {
        hackathon: {
          id: hackathon._id,
          name: hackathon.name,
          status: hackathon.status,
          hackathonStart: hackathon.hackathonStart,
          hackathonEnd: hackathon.hackathonEnd
        },
        leaderboard,
        activeSessions: formattedSessions,
        userSolves: formattedSolves
      }
    });
  } catch (error) {
    next(error);
  }
};

// Edit/Update Hackathon and log action
export const editHackathon = async (req, res, next) => {
  try {
    const { hackathonId } = req.params;
    const { name, description, banner, coverImage, hackathonStart, hackathonEnd, maxTeams, challenges, status } = req.body;

    const hackathon = await Hackathon.findById(hackathonId);
    if (!hackathon) {
      throw new AppError(ErrorCatalog.HACKATHON_NOT_FOUND);
    }

    const start = hackathonStart !== undefined ? hackathonStart : hackathon.hackathonStart;
    const end = hackathonEnd !== undefined ? hackathonEnd : hackathon.hackathonEnd;
    if (new Date(end) <= new Date(start)) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Xakaton yakunlanish vaqti boshlanish vaqtidan keyin bo\'lishi kerak.');
    }

    if (name && name !== hackathon.name) {
      const existing = await Hackathon.findOne({ name });
      if (existing) {
        throw new AppError(ErrorCatalog.HACKATHON_MAX_TEAMS_REACHED, 'Hackathon name already exists');
      }
      hackathon.name = name;
    }

    if (description !== undefined) hackathon.description = description;
    if (banner !== undefined) hackathon.banner = banner;
    if (coverImage !== undefined) hackathon.coverImage = coverImage;
    if (hackathonStart !== undefined) hackathon.hackathonStart = hackathonStart;
    if (hackathonEnd !== undefined) hackathon.hackathonEnd = hackathonEnd;
    if (maxTeams !== undefined) hackathon.maxTeams = maxTeams;
    if (status !== undefined) hackathon.status = status;

    if (challenges !== undefined) {
      const otherHackathons = await Hackathon.find({
        _id: { $ne: hackathonId },
        challenges: { $in: challenges }
      });
      if (otherHackathons.length > 0) {
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Bitta topshiriq faqat bitta xakatonga bog\'lanishi mumkin.');
      }
      hackathon.challenges = challenges;
    }

    await hackathon.save();
    await LifecycleService.syncHackathonLifecycle();

    await AuditLog.create({
      userId: req.user.userId,
      action: 'EDIT_HACKATHON',
      status: 'success',
      details: { hackathonId, hackathonName: hackathon.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: 'Hackathon updated successfully.',
      data: hackathon
    });
  } catch (error) {
    next(error);
  }
};

// Delete Hackathon, clear associated News and pull Team links
export const deleteHackathon = async (req, res, next) => {
  try {
    const { hackathonId } = req.params;

    const hackathon = await Hackathon.findById(hackathonId);
    if (!hackathon) {
      throw new AppError(ErrorCatalog.HACKATHON_NOT_FOUND);
    }

    const hackathonName = hackathon.name;

    // Delete Hackathon document
    await Hackathon.findByIdAndDelete(hackathonId);

    // Delete associated News items
    await News.deleteMany({ hackathonId });

    // Pull from all registered teams
    await Team.updateMany(
      { hackathonsJoined: hackathonId },
      { $pull: { hackathonsJoined: hackathonId } }
    );

    // Log action to AuditLog
    await AuditLog.create({
      userId: req.user.userId,
      action: 'DELETE_HACKATHON',
      status: 'success',
      details: { hackathonId, hackathonName },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: 'Hackathon and associated resources deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};

export const manuallyFinishChallenge = async (req, res, next) => {
  try {
    const { challengeId } = req.body;
    if (!challengeId) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'challengeId is required');
    }

    const challenge = await CTF.findById(challengeId);
    if (!challenge) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
    }

    if (challenge.status !== 'active') {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Tugatish uchun challenge statusi faol (active) bo\'lishi shart.');
    }

    challenge.status = 'finished';
    challenge.endTime = new Date();
    await challenge.save();

    await ChallengeSession.updateMany(
      { challengeId, status: 'active' },
      { $set: { status: 'expired', expiresAt: new Date() } }
    );
    await TeamChallenge.updateMany(
      { challengeId, status: 'active' },
      { $set: { status: 'expired', expiresAt: new Date() } }
    );

    await LeaderboardService.recalculateUserRankings();
    await LeaderboardService.recalculateTeamRankings();

    const { emitToGlobal } = await import('../config/socket.js');
    emitToGlobal('challenge:finished', { challengeId });
    emitToGlobal('leaderboard:update', { type: 'challenge', challengeId });

    await AuditLog.create({
      userId: req.user.userId,
      action: 'FINISH_CHALLENGE',
      status: 'success',
      details: { challengeId, challengeTitle: challenge.title },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: 'Challenge finished successfully.'
    });
  } catch (error) {
    next(error);
  }
};

export const manuallyFinishHackathon = async (req, res, next) => {
  try {
    const { hackathonId } = req.body;
    if (!hackathonId) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'hackathonId is required');
    }

    const hackathon = await Hackathon.findById(hackathonId);
    if (!hackathon) {
      throw new AppError(ErrorCatalog.HACKATHON_NOT_FOUND);
    }

    if (hackathon.status !== 'active') {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Tugatish uchun xakaton statusi faol (active) bo\'lishi shart.');
    }

    hackathon.status = 'finished';
    hackathon.hackathonEnd = new Date();
    await hackathon.save();

    const challengeIds = hackathon.challenges || [];
    if (challengeIds.length > 0) {
      await ChallengeSession.updateMany(
        { challengeId: { $in: challengeIds }, status: 'active' },
        { $set: { status: 'expired', expiresAt: new Date() } }
      );
      await TeamChallenge.updateMany(
        { challengeId: { $in: challengeIds }, status: 'active' },
        { $set: { status: 'expired', expiresAt: new Date() } }
      );
    }

    await LeaderboardService.recalculateUserRankings();
    await LeaderboardService.recalculateTeamRankings();

    const { emitToGlobal } = await import('../config/socket.js');
    emitToGlobal('hackathon:finished', { hackathonId });
    emitToGlobal('leaderboard:update', { type: 'hackathon', hackathonId });

    for (const cId of challengeIds) {
      emitToGlobal('timer:expired', { challengeId: cId });
    }

    await AuditLog.create({
      userId: req.user.userId,
      action: 'FINISH_HACKATHON',
      status: 'success',
      details: { hackathonId, hackathonName: hackathon.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: 'Hackathon finished successfully.'
    });
  } catch (error) {
    next(error);
  }
};

// Score recalculation helpers
const recalculateUserScores = async (userId) => {
  const personalSolves = await ChallengeSolve.find({ userId, teamId: null });
  const team = await Team.findOne({ members: userId });
  let teamSolves = [];
  if (team) {
    teamSolves = await ChallengeSolve.find({ teamId: team._id });
  }

  const personalPoints = personalSolves.reduce((sum, s) => sum + (s.pointsAwarded || 0), 0);
  const teamPoints = teamSolves.reduce((sum, s) => sum + (s.pointsAwarded || 0), 0);
  const totalPoints = personalPoints + teamPoints;

  const personalChallengeIds = personalSolves.map(s => s.challengeId);
  const teamChallengeIds = teamSolves.map(s => s.challengeId);

  const personalCtfs = await CTF.find({ _id: { $in: personalChallengeIds } });
  const teamCtfs = await CTF.find({ _id: { $in: teamChallengeIds } });

  const personalStars = personalCtfs.reduce((sum, c) => sum + c.stars, 0);
  const teamStars = teamCtfs.reduce((sum, c) => sum + c.stars, 0);
  const totalStars = personalStars + teamStars;

  await User.findByIdAndUpdate(userId, {
    points: totalPoints,
    totalScore: totalPoints,
    stars: totalStars,
    'statistics.pointsEarned': totalPoints,
    'statistics.starsEarned': totalStars,
    'statistics.totalSolved': personalSolves.length + teamSolves.length
  });
};

const recalculateTeamScores = async (teamId) => {
  const teamSolves = await ChallengeSolve.find({ teamId });
  const teamPoints = teamSolves.reduce((sum, s) => sum + (s.pointsAwarded || 0), 0);

  const teamChallengeIds = teamSolves.map(s => s.challengeId);
  const teamCtfs = await CTF.find({ _id: { $in: teamChallengeIds } });
  const teamStars = teamCtfs.reduce((sum, c) => sum + c.stars, 0);

  await Team.findByIdAndUpdate(teamId, {
    points: teamPoints,
    stars: teamStars
  });
};

export const getResetInfo = async (req, res, next) => {
  try {
    const { type, targetId } = req.query;

    if (!['challenge', 'ctf', 'hackathon'].includes(type)) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Invalid reset type');
    }

    let affectedUsersCount = 0;
    let affectedTeamsCount = 0;
    let details = {};

    if (type === 'challenge') {
      if (!targetId) {
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'targetId is required for challenge type');
      }
      const challenge = await CTF.findById(targetId);
      if (!challenge) {
        throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
      }
      affectedUsersCount = await ChallengeSession.countDocuments({ challengeId: targetId });
      affectedTeamsCount = await TeamChallenge.countDocuments({ challengeId: targetId });
      const solveCount = await ChallengeSolve.countDocuments({ challengeId: targetId });
      details = {
        title: challenge.title,
        activeSessions: affectedUsersCount,
        activeTeamSessions: affectedTeamsCount,
        totalSolves: solveCount
      };
    } else if (type === 'ctf') {
      affectedUsersCount = await ChallengeSession.countDocuments({});
      const solveCount = await ChallengeSolve.countDocuments({ teamId: null });
      details = {
        activeSessions: affectedUsersCount,
        totalPracticeSolves: solveCount
      };
    } else if (type === 'hackathon') {
      if (!targetId) {
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'targetId is required for hackathon type');
      }
      const hackathon = await Hackathon.findById(targetId);
      if (!hackathon) {
        throw new AppError(ErrorCatalog.HACKATHON_NOT_FOUND);
      }
      const challengeIds = hackathon.challenges || [];
      affectedTeamsCount = await TeamChallenge.countDocuments({ challengeId: { $in: challengeIds } });
      const solveCount = await ChallengeSolve.countDocuments({ challengeId: { $in: challengeIds } });
      details = {
        name: hackathon.name,
        activeTeamSessions: affectedTeamsCount,
        totalSolves: solveCount
      };
    }

    res.status(200).json({
      success: true,
      data: {
        type,
        targetId,
        details
      }
    });
  } catch (error) {
    next(error);
  }
};

export const performReset = async (req, res, next) => {
  try {
    const { type, targetId } = req.body;

    if (!['challenge', 'ctf', 'hackathon'].includes(type)) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Invalid reset type');
    }

    let affectedUserIds = new Set();
    let affectedTeamIds = new Set();

    if (type === 'challenge') {
      if (!targetId) {
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'targetId is required for challenge type');
      }

      // Find affected users/teams from sessions/solves
      const sessions = await ChallengeSession.find({ challengeId: targetId }).select('userId');
      const teamSessions = await TeamChallenge.find({ challengeId: targetId }).select('teamId');
      const solves = await ChallengeSolve.find({ challengeId: targetId }).select('userId teamId');

      sessions.forEach(s => affectedUserIds.add(s.userId.toString()));
      teamSessions.forEach(ts => affectedTeamIds.add(ts.teamId.toString()));
      solves.forEach(sv => {
        if (sv.userId) affectedUserIds.add(sv.userId.toString());
        if (sv.teamId) affectedTeamIds.add(sv.teamId.toString());
      });

      // Delete sessions, solves, completedCtfs links
      await ChallengeSession.deleteMany({ challengeId: targetId });
      await TeamChallenge.deleteMany({ challengeId: targetId });
      await ChallengeSolve.deleteMany({ challengeId: targetId });
      
      await User.updateMany(
        { completedCtfs: targetId },
        { $pull: { completedCtfs: targetId } }
      );

      // Recalculate affected users and teams
      for (const uId of affectedUserIds) {
        await recalculateUserScores(uId);
      }
      for (const tId of affectedTeamIds) {
        await recalculateTeamScores(tId);
      }

    } else if (type === 'ctf') {
      // Practice CTF Reset: resets all non-hackathon ctf sessions and solves
      const sessions = await ChallengeSession.find({}).select('userId');
      const solves = await ChallengeSolve.find({ teamId: null }).select('userId');

      sessions.forEach(s => affectedUserIds.add(s.userId.toString()));
      solves.forEach(sv => affectedUserIds.add(sv.userId.toString()));

      await ChallengeSession.deleteMany({});
      await ChallengeSolve.deleteMany({ teamId: null });

      // Pull all CTF challenges from completedCtfs of all users
      const activeHackathons = await Hackathon.find({});
      const hackathonChallengeIds = new Set();
      activeHackathons.forEach(h => {
        if (h.challenges) {
          h.challenges.forEach(id => hackathonChallengeIds.add(id.toString()));
        }
      });

      const allUsers = await User.find({});
      for (const user of allUsers) {
        const keptCompleted = (user.completedCtfs || []).filter(cId => hackathonChallengeIds.has(cId.toString()));
        user.completedCtfs = keptCompleted;
        await user.save();
        await recalculateUserScores(user._id);
      }

    } else if (type === 'hackathon') {
      if (!targetId) {
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'targetId is required for hackathon type');
      }
      const hackathon = await Hackathon.findById(targetId);
      if (!hackathon) {
        throw new AppError(ErrorCatalog.HACKATHON_NOT_FOUND);
      }

      const challengeIds = hackathon.challenges || [];

      // Find affected teams/users
      const teamSessions = await TeamChallenge.find({ challengeId: { $in: challengeIds } }).select('teamId');
      const solves = await ChallengeSolve.find({ challengeId: { $in: challengeIds } }).select('userId teamId');

      teamSessions.forEach(ts => affectedTeamIds.add(ts.teamId.toString()));
      solves.forEach(sv => {
        if (sv.userId) affectedUserIds.add(sv.userId.toString());
        if (sv.teamId) affectedTeamIds.add(sv.teamId.toString());
      });

      // Clear team finishTime
      for (const tId of affectedTeamIds) {
        await Team.findByIdAndUpdate(tId, { $unset: { finishTime: 1 } });
      }

      // Delete session and solve docs
      await TeamChallenge.deleteMany({ challengeId: { $in: challengeIds } });
      await ChallengeSolve.deleteMany({ challengeId: { $in: challengeIds } });

      // Pull challenges from user completed list
      await User.updateMany(
        { _id: { $in: Array.from(affectedUserIds) } },
        { $pull: { completedCtfs: { $in: challengeIds } } }
      );

      // Recalculate
      for (const uId of affectedUserIds) {
        await recalculateUserScores(uId);
      }
      for (const tId of affectedTeamIds) {
        await recalculateTeamScores(tId);
      }
    }

    // Finally, recalculate rankings
    await LeaderboardService.recalculateUserRankings();
    await LeaderboardService.recalculateTeamRankings();

    // Log admin activity
    await AuditLog.create({
      userId: req.user.userId,
      action: 'ADMIN_RESET_PROGRESS',
      status: 'success',
      details: { type, targetId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: `${type} progress successfully reset. Standings and rankings synchronized.`
    });
  } catch (error) {
    next(error);
  }
};
