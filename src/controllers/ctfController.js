import CTF from '../models/CTF.js';
import Team from '../models/Team.js';
import User from '../models/User.js';
import Hackathon from '../models/Hackathon.js';
import ChallengeSession from '../models/ChallengeSession.js';
import AuditLog from '../models/AuditLog.js';
import { AppError, ErrorCatalog } from '../utils/errors.js';

import { LeaderboardService } from '../services/leaderboardService.js';
import { emitToGlobal, emitToTeam, emitToHackathon } from '../config/socket.js';
import bcrypt from 'bcryptjs';

// Get active challenges, filtering out drafts unless admin/staff
export const getChallenges = async (req, res, next) => {
  try {
    const { category, difficulty, status, availableForHackathon } = req.query;
    const isStaffOrAdmin = req.user && (req.user.roles && (req.user.roles.includes('admin') || req.user.roles.includes('staff')));
    
    let query = {};
    if (isStaffOrAdmin) {
      if (status) {
        query.status = status;
      }
    } else {
      query.status = 'active';
    }

    if (category) query.category = category;
    if (difficulty) query.difficulty = difficulty;

    if (availableForHackathon) {
      let hackathonQuery = {};
      if (availableForHackathon !== 'new') {
        hackathonQuery._id = { $ne: availableForHackathon };
      }
      const otherHackathons = await Hackathon.find(hackathonQuery).select('challenges');
      const boundChallengeIds = otherHackathons.reduce((acc, h) => {
        return acc.concat(h.challenges.map(id => id.toString()));
      }, []);
      query._id = { $nin: boundChallengeIds };
    } else if (!isStaffOrAdmin) {
      // Filter: By default, get challenges.
      // If challenge is associated with an active/upcoming hackathon, hide it from global list
      const activeHackathons = await Hackathon.find({
        status: { $in: ['open', 'closed', 'running'] }
      }).select('challenges');
      
      const hackathonChallengeIds = activeHackathons.reduce((acc, h) => {
        return acc.concat(h.challenges.map(id => id.toString()));
      }, []);

      // Global list only shows permanent challenges
      query._id = { $nin: hackathonChallengeIds };
    }

    const challenges = await CTF.find(query)
      .select('title shortDescription longDescription difficulty stars category author status questions attachments image')
      .populate('author', 'username');

    res.status(200).json({
      success: true,
      data: challenges
    });
  } catch (error) {
    next(error);
  }
};

// Open a challenge details view or retrieve existing session details
export const getChallengeDetails = async (req, res, next) => {
  try {
    const { challengeId } = req.params;
    const userId = req.user.userId;

    const challenge = await CTF.findOne({ _id: challengeId, status: 'active' });
    if (!challenge) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
    }

    // Find user's team
    const team = await Team.findOne({ members: userId });
    const teamId = team ? team._id : null;

    let session = null;
    if (teamId) {
      session = await ChallengeSession.findOne({ teamId, challengeId });
    }

    if (!session) {
      return res.status(200).json({
        success: true,
        data: {
          hasActiveSession: false,
          challenge: {
            _id: challenge._id,
            title: challenge.title,
            shortDescription: challenge.shortDescription,
            longDescription: challenge.longDescription,
            difficulty: challenge.difficulty,
            stars: challenge.stars,
            category: challenge.category,
            timerMinutes: challenge.timerMinutes,
            image: challenge.image,
            attachments: challenge.attachments || [],
            questionsCount: challenge.questions.length,
            flagsCount: challenge.flags.length
          }
        }
      });
    }

    // Check if session has expired
    if (session.status === 'active' && new Date() > session.expiresAt) {
      session.status = 'expired';
      await session.save();
    }

    // Prepare questions projection (omit answers for security!)
    const questionsWithoutAnswers = challenge.questions.map(q => {
      return {
        id: q._id,
        title: q.title,
        description: q.description,
        points: q.points || q.score || 100,
        hint: q.hint || '',
        isSolved: session.solvedQuestions.some(sq => sq.questionId.toString() === q._id.toString())
      };
    });

    res.status(200).json({
      success: true,
      data: {
        hasActiveSession: true,
        sessionId: session._id,
        challengeId: challenge._id,
        title: challenge.title,
        longDescription: challenge.longDescription,
        difficulty: challenge.difficulty,
        stars: challenge.stars,
        category: challenge.category,
        timerMinutes: challenge.timerMinutes,
        image: challenge.image,
        attachments: challenge.attachments || [],
        openedAt: session.openedAt,
        expiresAt: session.expiresAt,
        timeRemainingSeconds: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
        status: session.status,
        questions: questionsWithoutAnswers,
        solvedFlags: session.solvedFlags || [],
        flagsCount: challenge.flags.length
      }
    });
  } catch (error) {
    next(error);
  }
};

export const startChallengeSession = async (req, res, next) => {
  try {
    const { challengeId } = req.params;
    const teamId = req.team._id;

    const challenge = await CTF.findOne({ _id: challengeId, status: 'active' });
    if (!challenge) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
    }

    // Check if challenge is part of an active/upcoming hackathon
    const hackathon = await Hackathon.findOne({ 
      challenges: challengeId,
      status: { $in: ['open', 'closed', 'running'] }
    });
    if (hackathon) {
      if (!req.team.hackathonsJoined.includes(hackathon._id)) {
        throw new AppError(ErrorCatalog.HACKATHON_TEAM_NOT_REGISTERED);
      }
      if (hackathon.status !== 'running') {
        throw new AppError(ErrorCatalog.HACKATHON_NOT_ACTIVE);
      }
    }

    // Check if team already has a session
    let session = await ChallengeSession.findOne({ teamId, challengeId });
    
    if (!session) {
      const durationMs = (challenge.timerMinutes || 60) * 60 * 1000;
      const expiresAt = new Date(Date.now() + durationMs);

      session = new ChallengeSession({
        teamId,
        challengeId,
        expiresAt
      });
      await session.save();

      await AuditLog.create({
        userId: req.user.userId,
        teamId,
        action: 'CHALLENGE_SESSION_START',
        status: 'success',
        details: { challengeId, challengeTitle: challenge.title },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
    }

    // Prepare questions projection
    const questionsWithoutAnswers = challenge.questions.map(q => {
      return {
        id: q._id,
        title: q.title,
        description: q.description,
        points: q.points || q.score || 100,
        hint: q.hint || '',
        isSolved: session.solvedQuestions.some(sq => sq.questionId.toString() === q._id.toString())
      };
    });

    res.status(200).json({
      success: true,
      data: {
        hasActiveSession: true,
        sessionId: session._id,
        challengeId: challenge._id,
        title: challenge.title,
        longDescription: challenge.longDescription,
        difficulty: challenge.difficulty,
        stars: challenge.stars,
        category: challenge.category,
        timerMinutes: challenge.timerMinutes,
        image: challenge.image,
        attachments: challenge.attachments || [],
        openedAt: session.openedAt,
        expiresAt: session.expiresAt,
        timeRemainingSeconds: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
        status: session.status,
        questions: questionsWithoutAnswers,
        solvedFlags: session.solvedFlags || [],
        flagsCount: challenge.flags.length
      }
    });
  } catch (error) {
    next(error);
  }
};

// Unlock a hint for a specific question - preserved for route safety
export const unlockHint = async (req, res, next) => {
  res.status(200).json({
    success: true,
    message: 'Hint already unlocked.',
    data: { text: '' }
  });
};

export const submitQuestionAnswer = async (req, res, next) => {
  try {
    const { challengeId, questionId } = req.params;
    const { answer } = req.body;
    const teamId = req.team._id;
    const userId = req.user.userId;

    const session = await ChallengeSession.findOne({ teamId, challengeId, status: 'active' });
    if (!session) {
      throw new AppError(ErrorCatalog.CTF_SESSION_NOT_FOUND);
    }

    if (new Date() > session.expiresAt) {
      session.status = 'expired';
      await session.save();
      throw new AppError(ErrorCatalog.CTF_SESSION_EXPIRED);
    }

    if (session.failedAttempts >= 5) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Maksimal urinishlar sonidan oshib ketildi (5 ta xato urinish). Topshiriq bloklandi.');
    }

    // Check if already solved
    const alreadySolved = session.solvedQuestions.some(sq => sq.questionId.toString() === questionId);
    if (alreadySolved) {
      throw new AppError(ErrorCatalog.CTF_ALREADY_SOLVED);
    }

    const challenge = await CTF.findById(challengeId);
    const question = challenge.questions.id(questionId);
    if (!question) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND, 'Question not found');
    }

    // Verify answer (bcrypt comparison)
    const isMatch = await bcrypt.compare(answer, question.answer);
    if (!isMatch) {
      session.failedAttempts = (session.failedAttempts || 0) + 1;
      await session.save();

      await AuditLog.create({
        userId,
        teamId,
        action: 'SUBMIT_QUESTION_FAILURE',
        status: 'failure',
        details: { challengeId, questionId, failedAttempts: session.failedAttempts },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
      throw new AppError(ErrorCatalog.CTF_FLAG_INCORRECT, `Incorrect answer. Urinishlar: ${session.failedAttempts}/5`);
    }

    const scoreAwarded = question.points || question.score || 100;

    session.solvedQuestions.push({
      questionId,
      pointsAwarded: scoreAwarded,
      solvedAt: new Date()
    });

    await session.save();

    // Award points to team
    await Team.findByIdAndUpdate(teamId, {
      $inc: { points: scoreAwarded }
    });

    // Award points to all team members
    await User.updateMany(
      { _id: { $in: req.team.members } },
      { 
        $inc: { points: scoreAwarded },
        $set: { lastActive: new Date() }
      }
    );

    // Update user stats
    const statsField = `${challenge.difficulty}Solved`;
    await User.findByIdAndUpdate(userId, {
      $inc: {
        'statistics.totalSolved': 1,
        [`statistics.${statsField}`]: 1,
        'statistics.pointsEarned': scoreAwarded
      }
    });

    await LeaderboardService.recalculateUserRankings();
    await LeaderboardService.recalculateTeamRankings();

    // Audit success
    await AuditLog.create({
      userId,
      teamId,
      action: 'SUBMIT_QUESTION_SUCCESS',
      status: 'success',
      details: { challengeId, questionId, scoreAwarded },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    // Socket broadcasts
    const solveData = {
      teamName: req.team.name,
      challengeTitle: challenge.title,
      questionTitle: question.title,
      points: scoreAwarded,
      solvedAt: new Date()
    };

    emitToGlobal('challenge:question_solved', solveData);
    emitToTeam(teamId, 'team:score_update', { points: scoreAwarded });

    res.status(200).json({
      success: true,
      message: 'Correct answer! Points added to team score.',
      data: {
        pointsAwarded: scoreAwarded
      }
    });
  } catch (error) {
    next(error);
  }
};

export const submitChallengeFlag = async (req, res, next) => {
  try {
    const { challengeId, flagIndex } = req.params;
    const { flag } = req.body;
    const teamId = req.team._id;
    const userId = req.user.userId;

    const session = await ChallengeSession.findOne({ teamId, challengeId, status: 'active' });
    if (!session) {
      throw new AppError(ErrorCatalog.CTF_SESSION_NOT_FOUND);
    }

    if (new Date() > session.expiresAt) {
      session.status = 'expired';
      await session.save();
      throw new AppError(ErrorCatalog.CTF_SESSION_EXPIRED);
    }

    if (session.failedAttempts >= 5) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Maksimal urinishlar sonidan oshib ketildi (5 ta xato urinish). Topshiriq bloklandi.');
    }

    const index = parseInt(flagIndex, 10);
    if (isNaN(index)) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Invalid flag index');
    }

    const challenge = await CTF.findById(challengeId);
    if (!challenge) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
    }

    if (index < 0 || index >= challenge.flags.length) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Flag index out of range');
    }

    // Check if flag index is already solved
    const alreadySolved = session.solvedFlags.some(sf => sf.flagIndex === index);
    if (alreadySolved) {
      throw new AppError(ErrorCatalog.CTF_ALREADY_SOLVED, 'Flag already verified');
    }

    // Verify flag (bcrypt comparison)
    const isMatch = await bcrypt.compare(flag, challenge.flags[index]);
    if (!isMatch) {
      session.failedAttempts = (session.failedAttempts || 0) + 1;
      await session.save();

      await AuditLog.create({
        userId,
        teamId,
        action: 'SUBMIT_FLAG_FAILURE',
        status: 'failure',
        details: { challengeId, flagIndex: index, failedAttempts: session.failedAttempts },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
      throw new AppError(ErrorCatalog.CTF_FLAG_INCORRECT, `Incorrect flag. Urinishlar: ${session.failedAttempts}/5`);
    }

    // Record solved flag
    session.solvedFlags.push({
      flagIndex: index,
      solvedAt: new Date()
    });

    // Check if all flags are solved
    const solvedIndexes = session.solvedFlags.map(sf => sf.flagIndex);
    const allFlagsSolved = challenge.flags.every((_, i) => solvedIndexes.includes(i));
    let fullyCompleted = false;

    if (allFlagsSolved) {
      session.status = 'completed';
      fullyCompleted = true;

      // Award stars to team
      await Team.findByIdAndUpdate(teamId, {
        $inc: { stars: challenge.stars }
      });

      // Award stars to all team members
      await User.updateMany(
        { _id: { $in: req.team.members } },
        { 
          $inc: { stars: challenge.stars },
          $set: { lastActive: new Date() }
        }
      );

      // Update stars statistics for the user
      await User.findByIdAndUpdate(userId, {
        $inc: {
          'statistics.starsEarned': challenge.stars,
          'statistics.hackathonsJoined': 1
        }
      });

      await LeaderboardService.recalculateUserRankings();
      await LeaderboardService.recalculateTeamRankings();

      await AuditLog.create({
        userId,
        teamId,
        action: 'CHALLENGE_COMPLETE',
        status: 'success',
        details: { challengeId, starsAwarded: challenge.stars },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
    }

    await session.save();

    await AuditLog.create({
      userId,
      teamId,
      action: 'SUBMIT_FLAG_SUCCESS',
      status: 'success',
      details: { challengeId, flagIndex: index },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: fullyCompleted ? 'Correct flag verified! Challenge successfully solved!' : 'Correct flag verified!',
      data: {
        fullyCompleted
      }
    });
  } catch (error) {
    next(error);
  }
};

export const finishChallenge = async (req, res, next) => {
  try {
    const { challengeId } = req.params;
    const teamId = req.team._id;
    const userId = req.user.userId;

    const session = await ChallengeSession.findOne({ teamId, challengeId, status: 'active' });
    if (!session) {
      throw new AppError(ErrorCatalog.CTF_SESSION_NOT_FOUND);
    }

    if (new Date() > session.expiresAt) {
      session.status = 'expired';
      await session.save();
      throw new AppError(ErrorCatalog.CTF_SESSION_EXPIRED);
    }

    const challenge = await CTF.findById(challengeId);
    if (!challenge) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
    }

    // Check if all flags are solved
    const solvedIndexes = session.solvedFlags.map(sf => sf.flagIndex);
    const allFlagsSolved = challenge.flags.every((_, i) => solvedIndexes.includes(i));

    if (!allFlagsSolved) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'You must solve all challenge flags before finishing.');
    }

    // Complete session
    session.status = 'completed';
    await session.save();

    // Award stars to team
    await Team.findByIdAndUpdate(teamId, {
      $inc: { stars: challenge.stars }
    });

    // Award stars to all team members
    await User.updateMany(
      { _id: { $in: req.team.members } },
      { 
        $inc: { stars: challenge.stars },
        $set: { lastActive: new Date() }
      }
    );

    // Update stars statistics for the user
    await User.findByIdAndUpdate(userId, {
      $inc: {
        'statistics.starsEarned': challenge.stars,
        'statistics.hackathonsJoined': 1
      }
    });

    await LeaderboardService.recalculateUserRankings();
    await LeaderboardService.recalculateTeamRankings();

    await AuditLog.create({
      userId,
      teamId,
      action: 'CHALLENGE_COMPLETE',
      status: 'success',
      details: { challengeId, starsAwarded: challenge.stars },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    // WebSockets update
    const completeData = {
      teamName: req.team.name,
      challengeTitle: challenge.title,
      stars: challenge.stars,
      completedAt: new Date()
    };

    emitToGlobal('challenge:completed', completeData);
    emitToTeam(teamId, 'team:stars_update', { stars: challenge.stars });

    res.status(200).json({
      success: true,
      message: 'Challenge finished successfully! Stars have been awarded.',
      data: {
        starsAwarded: challenge.stars
      }
    });
  } catch (error) {
    next(error);
  }
};
