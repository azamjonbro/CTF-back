import CTF from '../models/CTF.js';
import Team from '../models/Team.js';
import User from '../models/User.js';
import Hackathon from '../models/Hackathon.js';
import ChallengeSession from '../models/ChallengeSession.js';
import TeamChallenge from '../models/TeamChallenge.js';
import AuditLog from '../models/AuditLog.js';
import ChallengeSolve from '../models/ChallengeSolve.js';
import { AppError, ErrorCatalog } from '../utils/errors.js';
import mongoose from 'mongoose';

import { LeaderboardService } from '../services/leaderboardService.js';
import { emitToGlobal, emitToTeam, emitToHackathon } from '../config/socket.js';
import bcrypt from 'bcryptjs';

const getChallengeMode = async (challengeId) => {
  const hackathon = await Hackathon.findOne({
    challenges: challengeId,
    status: { $in: ['upcoming', 'active'] }
  });
  return hackathon ? 'hackathon' : 'practice';
};

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
        status: { $in: ['upcoming', 'active'] }
      }).select('challenges');
      
      const hackathonChallengeIds = activeHackathons.reduce((acc, h) => {
        return acc.concat(h.challenges.map(id => id.toString()));
      }, []);

      // Global list only shows permanent challenges
      query._id = { $nin: hackathonChallengeIds };
    }

    let selectFields = 'title shortDescription longDescription difficulty stars category author status questions attachments image timerMinutes points';
    if (isStaffOrAdmin) {
      selectFields += ' flags';
    }

    const challenges = await CTF.find(query)
      .select(selectFields)
      .populate('author', 'username');

    let solvedIds = [];
    if (req.user && req.user.userId) {
      const userSolves = await ChallengeSolve.find({ userId: req.user.userId }).select('challengeId');
      solvedIds = userSolves.map(s => s.challengeId.toString());
    }

    const challengesMapped = challenges.map(c => {
      const cObj = c.toObject();
      cObj.isSolved = solvedIds.includes(c._id.toString());
      return cObj;
    });

    res.status(200).json({
      success: true,
      data: challengesMapped
    });
  } catch (error) {
    next(error);
  }
};

const checkCTFStartAndStatus = async (challengeId, userId, res) => {
  // Check CTF challenge status
  const challenge = await CTF.findById(challengeId);
  if (!challenge) {
    throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
  }
  if (challenge.status === 'finished') {
    throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Ushbu topshiriq faol emas yoki yakunlangan.');
  }
  if (challenge.status !== 'active') {
    throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Topshiriq faol emas.');
  }

  const mode = await getChallengeMode(challengeId);
  let sessionExists = false;
  let team = null;

  if (mode === 'hackathon') {
    team = await Team.findOne({ members: userId });
    if (team) {
      sessionExists = await TeamChallenge.exists({ teamId: team._id, challengeId });
    }
  } else {
    sessionExists = await ChallengeSession.exists({ userId, challengeId });
  }

  if (!sessionExists) {
    res.status(403).json({
      success: false,
      message: "You must start the CTF before accessing challenges."
    });
    return null;
  }

  return { challenge, mode, team };
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

    const mode = await getChallengeMode(challengeId);
    let session = null;
    let team = null;

    if (mode === 'hackathon') {
      team = await Team.findOne({ members: userId });
      const teamId = team ? team._id : null;
      if (teamId) {
        session = await TeamChallenge.findOne({ teamId, challengeId });
      }
    } else {
      session = await ChallengeSession.findOne({ userId, challengeId });
    }

    // Check if challenge is already solved permanently
    let isSolved = false;
    if (mode === 'hackathon') {
      if (team) {
        isSolved = await ChallengeSolve.exists({ teamId: team._id, challengeId });
      }
    } else {
      isSolved = await ChallengeSolve.exists({ userId, challengeId });
    }

    const hackathon = await Hackathon.findOne({
      challenges: challengeId,
      status: { $in: ['upcoming', 'active'] }
    });

    if (!session) {
      let participantCount = 0;
      if (mode === 'hackathon') {
        participantCount = await TeamChallenge.countDocuments({ challengeId });
      } else {
        participantCount = await ChallengeSession.countDocuments({ challengeId });
      }

      return res.status(200).json({
        success: true,
        data: {
          hasActiveSession: false,
          isSolved: !!isSolved,
          challenge: {
            _id: challenge._id,
            title: challenge.title,
            shortDescription: challenge.shortDescription,
            longDescription: challenge.longDescription,
            timerMinutes: challenge.timerMinutes,
            startTime: hackathon ? hackathon.hackathonStart : challenge.createdAt,
            endTime: hackathon ? hackathon.hackathonEnd : (challenge.endTime || null),
            participantCount
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
      const isUnlocked = session.hintsUnlocked.some(hu => hu.questionId.toString() === q._id.toString());
      return {
        id: q._id,
        title: q.title,
        description: q.description,
        points: q.points !== undefined ? q.points : 10,
        hasHint: !!q.hint,
        hintUnlocked: isUnlocked,
        hint: isUnlocked ? (q.hint || '') : '',
        isSolved: session.solvedQuestions.some(sq => sq.questionId.toString() === q._id.toString())
      };
    });

    // Project flags metadata for active workspace securely (omit flag hashes!)
    const flagsProjected = challenge.flags.map((f, i) => {
      const isHintUnlocked = session.flagHintsUnlocked && session.flagHintsUnlocked.includes(i);
      return {
        title: f.title || `Flag #${i + 1}`,
        description: f.description || '',
        points: Math.round(challenge.points / challenge.flags.length),
        attachment: f.attachment || '',
        hasHint: !!f.hint,
        hintUnlocked: isHintUnlocked,
        hint: isHintUnlocked ? (f.hint || '') : '',
        isSolved: session.solvedFlags.some(sf => sf.flagIndex === i)
      };
    });

    res.status(200).json({
      success: true,
      data: {
        hasActiveSession: true,
        sessionId: session._id,
        challengeId: challenge._id,
        isSolved: !!isSolved,
        title: challenge.title,
        shortDescription: challenge.shortDescription,
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
        failedAttempts: session.failedAttempts || 0,
        questionAttempts: session.questionAttempts || [],
        flagAttempts: session.flagAttempts || [],
        hasHint: !!challenge.hint,
        hintUsed: session.hintUsed || false,
        challengeHint: session.hintUsed ? challenge.hint : null,
        questions: questionsWithoutAnswers,
        flags: flagsProjected,
        solvedFlags: session.solvedFlags || [],
        flagsCount: challenge.flags.length,
        startTime: hackathon ? hackathon.hackathonStart : challenge.createdAt,
        endTime: hackathon ? hackathon.hackathonEnd : (challenge.endTime || null)
      }
    });
  } catch (error) {
    next(error);
  }
};

export const startChallengeSession = async (req, res, next) => {
  try {
    const { challengeId } = req.params;
    const userId = req.user.userId;

    const challenge = await CTF.findOne({ _id: challengeId, status: 'active' });
    if (!challenge) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
    }

    const mode = await getChallengeMode(challengeId);
    let session = null;
    let team = null;

    // Check if challenge is already solved in the permanent solves record
    let isSolvedRecord = false;
    if (mode === 'hackathon') {
      team = await Team.findOne({ members: userId });
      if (team) {
        isSolvedRecord = await ChallengeSolve.exists({ teamId: team._id, challengeId });
      }
    } else {
      isSolvedRecord = await ChallengeSolve.exists({ userId, challengeId });
    }
    if (isSolvedRecord) {
      throw new AppError(ErrorCatalog.CTF_ALREADY_SOLVED, 'Ushbu topshiriq allaqachon yechilgan.');
    }

    if (mode === 'hackathon') {
      if (!team) {
        team = await Team.findOne({ members: userId });
      }
      if (!team) {
        throw new AppError(ErrorCatalog.HACKATHON_TEAM_NOT_REGISTERED, 'Xakaton topshiriqlarini bajarish uchun jamoada bo\'lishingiz shart.');
      }
      const hackathon = await Hackathon.findOne({
        challenges: challengeId,
        status: { $in: ['open', 'closed', 'running'] }
      });
      if (hackathon) {
        if (!team.hackathonsJoined.includes(hackathon._id)) {
          throw new AppError(ErrorCatalog.HACKATHON_TEAM_NOT_REGISTERED);
        }
        if (hackathon.status !== 'running') {
          throw new AppError(ErrorCatalog.HACKATHON_NOT_ACTIVE);
        }
      }

      session = await TeamChallenge.findOne({ teamId: team._id, challengeId });
      if (!session) {
        const durationMs = (challenge.timerMinutes || 60) * 60 * 1000;
        const expiresAt = new Date(Date.now() + durationMs);

        session = new TeamChallenge({
          teamId: team._id,
          challengeId,
          expiresAt
        });
        await session.save();

        await AuditLog.create({
          userId,
          teamId: team._id,
          action: 'CHALLENGE_SESSION_START',
          status: 'success',
          details: { challengeId, challengeTitle: challenge.title, mode: 'hackathon' },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        });
      }
    } else {
      session = await ChallengeSession.findOne({ userId, challengeId });
      if (!session) {
        const durationMs = (challenge.timerMinutes || 60) * 60 * 1000;
        const expiresAt = new Date(Date.now() + durationMs);

        session = new ChallengeSession({
          userId,
          challengeId,
          expiresAt
        });
        await session.save();

        await AuditLog.create({
          userId,
          action: 'CHALLENGE_SESSION_START',
          status: 'success',
          details: { challengeId, challengeTitle: challenge.title, mode: 'practice' },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        });
      }
    }

    // Prepare questions projection
    const questionsWithoutAnswers = challenge.questions.map(q => {
      return {
        id: q._id,
        title: q.title,
        description: q.description,
        points: q.points !== undefined ? q.points : 10,
        hasHint: !!q.hint,
        hintUnlocked: false,
        hint: '',
        isSolved: false
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
        failedAttempts: session.failedAttempts || 0,
        questionAttempts: session.questionAttempts || [],
        flagAttempts: session.flagAttempts || [],
        hasHint: !!challenge.hint,
        hintUsed: session.hintUsed || false,
        challengeHint: session.hintUsed ? challenge.hint : null,
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

export const unlockQuestionHint = async (req, res, next) => {
  try {
    const { challengeId, questionId } = req.params;
    const userId = req.user.userId;

    const precheck = await checkCTFStartAndStatus(challengeId, userId, res);
    if (!precheck) return;
    const { challenge, mode, team } = precheck;

    let session = null;
    if (mode === 'hackathon') {
      session = await TeamChallenge.findOne({ teamId: team._id, challengeId, status: 'active' });
    } else {
      session = await ChallengeSession.findOne({ userId, challengeId, status: 'active' });
    }

    if (!session) {
      throw new AppError(ErrorCatalog.CTF_SESSION_NOT_FOUND);
    }

    if (new Date() > session.expiresAt) {
      session.status = 'expired';
      await session.save();
      throw new AppError(ErrorCatalog.CTF_SESSION_EXPIRED);
    }

    const question = challenge.questions.id(questionId);
    if (!question) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND, 'Question not found');
    }

    // Check if already unlocked
    const alreadyUnlocked = session.hintsUnlocked.some(hu => hu.questionId.toString() === questionId);
    if (alreadyUnlocked) {
      return res.status(200).json({
        success: true,
        message: 'Hint already unlocked.',
        data: { hint: question.hint || '' }
      });
    }

    // Check if question is already solved
    const isSolved = session.solvedQuestions.some(sq => sq.questionId.toString() === questionId);
    if (isSolved) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Bu savol allaqachon yechilgan. Maslahatni ochish mumkin emas.');
    }

    // Unlock hint atomically
    const hintObj = { questionId: new mongoose.Types.ObjectId(questionId), hintIndex: 0 };
    let updateResult;
    if (mode === 'hackathon') {
      updateResult = await TeamChallenge.updateOne(
        {
          _id: session._id,
          status: 'active',
          'hintsUnlocked.questionId': { $ne: hintObj.questionId }
        },
        {
          $push: { hintsUnlocked: hintObj }
        }
      );
    } else {
      updateResult = await ChallengeSession.updateOne(
        {
          _id: session._id,
          status: 'active',
          'hintsUnlocked.questionId': { $ne: hintObj.questionId }
        },
        {
          $push: { hintsUnlocked: hintObj }
        }
      );
    }

    if (updateResult.modifiedCount === 0) {
      return res.status(200).json({
        success: true,
        message: 'Hint already unlocked.',
        data: { hint: question.hint || '' }
      });
    }

    await session.save();

    await AuditLog.create({
      userId,
      teamId: team ? team._id : null,
      action: 'UNLOCK_QUESTION_HINT',
      status: 'success',
      details: { challengeId, questionId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: 'Hint unlocked successfully. A 20% score reduction will be applied to this question.',
      data: {
        hint: question.hint || ''
      }
    });
  } catch (error) {
    next(error);
  }
};

export const unlockFlagHint = async (req, res, next) => {
  try {
    const { challengeId, flagIndex } = req.params;
    const userId = req.user.userId;

    const index = parseInt(flagIndex, 10);
    if (isNaN(index)) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Invalid flag index');
    }

    const precheck = await checkCTFStartAndStatus(challengeId, userId, res);
    if (!precheck) return;
    const { challenge, mode, team } = precheck;

    let session = null;
    if (mode === 'hackathon') {
      session = await TeamChallenge.findOne({ teamId: team._id, challengeId, status: 'active' });
    } else {
      session = await ChallengeSession.findOne({ userId, challengeId, status: 'active' });
    }

    if (!session) {
      throw new AppError(ErrorCatalog.CTF_SESSION_NOT_FOUND);
    }

    if (new Date() > session.expiresAt) {
      session.status = 'expired';
      await session.save();
      throw new AppError(ErrorCatalog.CTF_SESSION_EXPIRED);
    }

    const flagObj = challenge.flags[index];
    if (!flagObj) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Flag index not found');
    }

    // Check if already unlocked
    const alreadyUnlocked = session.flagHintsUnlocked && session.flagHintsUnlocked.includes(index);
    if (alreadyUnlocked) {
      return res.status(200).json({
        success: true,
        message: 'Hint already unlocked.',
        data: { hint: flagObj.hint || '' }
      });
    }

    // Check if flag is already solved
    const isSolved = session.solvedFlags.some(sf => sf.flagIndex === index);
    if (isSolved) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Bu flag allaqachon yechilgan. Maslahatni ochish mumkin emas.');
    }

    // Unlock hint atomically
    let updateResult;
    if (mode === 'hackathon') {
      updateResult = await TeamChallenge.updateOne(
        {
          _id: session._id,
          status: 'active',
          flagHintsUnlocked: { $ne: index }
        },
        {
          $push: { flagHintsUnlocked: index }
        }
      );
    } else {
      updateResult = await ChallengeSession.updateOne(
        {
          _id: session._id,
          status: 'active',
          flagHintsUnlocked: { $ne: index }
        },
        {
          $push: { flagHintsUnlocked: index }
        }
      );
    }

    if (updateResult.modifiedCount === 0) {
      return res.status(200).json({
        success: true,
        message: 'Hint already unlocked.',
        data: { hint: flagObj.hint || '' }
      });
    }

    // Load updated session
    if (mode === 'hackathon') {
      session = await TeamChallenge.findById(session._id);
    } else {
      session = await ChallengeSession.findById(session._id);
    }

    await AuditLog.create({
      userId,
      teamId: team ? team._id : null,
      action: 'UNLOCK_FLAG_HINT',
      status: 'success',
      details: { challengeId, flagIndex: index },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: 'Hint unlocked successfully. A 20% score reduction will be applied to this flag.',
      data: {
        hint: flagObj.hint || ''
      }
    });
  } catch (error) {
    next(error);
  }
};

export const unlockChallengeHint = async (req, res, next) => {
  try {
    const { challengeId } = req.params;
    const userId = req.user.userId;

    const precheck = await checkCTFStartAndStatus(challengeId, userId, res);
    if (!precheck) return;
    const { challenge, mode, team } = precheck;

    let session = null;
    if (mode === 'hackathon') {
      session = await TeamChallenge.findOne({ teamId: team._id, challengeId, status: 'active' });
    } else {
      session = await ChallengeSession.findOne({ userId, challengeId, status: 'active' });
    }

    if (!session) {
      throw new AppError(ErrorCatalog.CTF_SESSION_NOT_FOUND);
    }

    if (new Date() > session.expiresAt) {
      session.status = 'expired';
      await session.save();
      throw new AppError(ErrorCatalog.CTF_SESSION_EXPIRED);
    }

    if (session.hintOpened || session.hintUsed || session.penaltyApplied) {
      return res.status(200).json({
        success: true,
        message: 'Hint already unlocked.',
        data: { hint: challenge.hint }
      });
    }

    if (mode === 'hackathon') {
      await TeamChallenge.updateOne(
        { _id: session._id, status: 'active' },
        { $set: { hintUsed: true, hintOpened: true, penaltyApplied: true } }
      );
    } else {
      await ChallengeSession.updateOne(
        { _id: session._id, status: 'active' },
        { $set: { hintUsed: true, hintOpened: true, penaltyApplied: true } }
      );
    }

    session.hintUsed = true;
    session.hintOpened = true;
    session.penaltyApplied = true;

    // Apply 20% penalty deduction on points earned so far in this session
    const questionsPoints = session.solvedQuestions.reduce((sum, sq) => sum + (sq.pointsAwarded || 0), 0);
    const flagsPoints = session.solvedFlags.reduce((sum, sf) => sum + (sf.pointsAwarded || 0), 0);
    const pointsEarned = questionsPoints + flagsPoints;
    const penalty = Math.round(pointsEarned * 0.2);

    if (penalty > 0) {
      // Reduce the points awarded for previously solved questions and flags in the session
      session.solvedQuestions.forEach(sq => {
        sq.pointsAwarded = Math.round(sq.pointsAwarded * 0.8);
      });
      session.solvedFlags.forEach(sf => {
        sf.pointsAwarded = Math.round(sf.pointsAwarded * 0.8);
      });

      if (mode === 'hackathon') {
        // Deduct from Team
        await Team.findByIdAndUpdate(team._id, {
          $inc: { points: -penalty }
        });

        // Deduct from all team members
        await User.updateMany(
          { _id: { $in: team.members } },
          { $inc: { 
            points: -penalty,
            'statistics.pointsEarned': -penalty
          } }
        );

        // Emit team score update
        emitToTeam(team._id.toString(), 'team:score', { 
          teamId: team._id.toString(),
          points: team.points - penalty,
          stars: team.stars
        });
        emitToTeam(team._id.toString(), 'team:score_update', { points: -penalty });
      } else {
        // Practice mode
        await User.findByIdAndUpdate(userId, {
          $inc: { 
            points: -penalty,
            'statistics.pointsEarned': -penalty
          }
        });
      }

      await LeaderboardService.recalculateUserRankings();
      if (mode === 'hackathon') {
        await LeaderboardService.recalculateTeamRankings();
        emitToGlobal('leaderboard:refresh', {});
      }
    }

    await session.save();

    await AuditLog.create({
      userId,
      teamId: team ? team._id : null,
      action: 'UNLOCK_CHALLENGE_HINT',
      status: 'success',
      details: { challengeId, penaltyApplied: penalty },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: 'Hint unlocked successfully. A 20% score reduction has been applied to this challenge.',
      data: {
        hint: challenge.hint,
        penaltyApplied: penalty
      }
    });
  } catch (error) {
    next(error);
  }
};

export const submitQuestionAnswer = async (req, res, next) => {
  try {
    const { challengeId, questionId } = req.params;
    const { answer } = req.body;
    const userId = req.user.userId;

    const precheck = await checkCTFStartAndStatus(challengeId, userId, res);
    if (!precheck) return;
    const { challenge, mode, team } = precheck;

    let session = null;
    if (mode === 'hackathon') {
      session = await TeamChallenge.findOne({ teamId: team._id, challengeId, status: 'active' });
    } else {
      session = await ChallengeSession.findOne({ userId, challengeId, status: 'active' });
    }

    if (!session) {
      throw new AppError(ErrorCatalog.CTF_SESSION_NOT_FOUND);
    }

    if (new Date() > session.expiresAt) {
      session.status = 'expired';
      await session.save();
      throw new AppError(ErrorCatalog.CTF_SESSION_EXPIRED);
    }

    // Check if user has exceeded attempts for this specific question
    let qaIndex = session.questionAttempts.findIndex(qa => qa.questionId.toString() === questionId);
    if (qaIndex === -1) {
      session.questionAttempts.push({ questionId, failedAttempts: 0 });
      qaIndex = session.questionAttempts.length - 1;
    }
    if (session.questionAttempts[qaIndex].failedAttempts >= 5) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Ushbu savol uchun maksimal urinishlar sonidan oshib ketildi (5 ta xato urinish). Savol bloklandi.');
    }

    // Check if already solved
    const alreadySolved = session.solvedQuestions.some(sq => sq.questionId.toString() === questionId);
    if (alreadySolved) {
      throw new AppError(ErrorCatalog.CTF_ALREADY_SOLVED);
    }

    if (challenge.status === 'finished') {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Ushbu topshiriq yakunlangan va javoblar qabul qilinmaydi.');
    }
    const hackathon = await Hackathon.findOne({
      challenges: challengeId,
      status: 'finished'
    });
    if (hackathon) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Ushbu xakaton yakunlangan va javoblar qabul qilinmaydi.');
    }
    const question = challenge.questions.id(questionId);
    if (!question) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND, 'Question not found');
    }

    // Verify answer (bcrypt comparison)
    const isMatch = await bcrypt.compare(answer, question.answer);
    if (!isMatch) {
      session.questionAttempts[qaIndex].failedAttempts += 1;
      session.failedAttempts = (session.failedAttempts || 0) + 1;
      await session.save();

      await AuditLog.create({
        userId,
        teamId: team ? team._id : null,
        action: 'SUBMIT_QUESTION_FAILURE',
        status: 'failure',
        details: { challengeId, questionId, failedAttempts: session.questionAttempts[qaIndex].failedAttempts },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
      throw new AppError(ErrorCatalog.CTF_FLAG_INCORRECT, `Incorrect answer. Ushbu savol uchun urinishlar: ${session.questionAttempts[qaIndex].failedAttempts}/5`);
    }

    // Calculate points to award
    const questionPoints = question.points !== undefined ? question.points : 10;
    const isHintUnlocked = session.hintsUnlocked && session.hintsUnlocked.some(hu => hu.questionId.toString() === questionId.toString());
    const scoreAwarded = isHintUnlocked ? Math.round(questionPoints * 0.8) : questionPoints;

    const solvedObj = {
      questionId: new mongoose.Types.ObjectId(questionId),
      pointsAwarded: scoreAwarded,
      solvedAt: new Date()
    };

    let updatedSession;
    if (mode === 'hackathon') {
      updatedSession = await TeamChallenge.findOneAndUpdate(
        { 
          _id: session._id, 
          status: 'active',
          'solvedQuestions.questionId': { $ne: solvedObj.questionId }
        },
        { 
          $push: { solvedQuestions: solvedObj } 
        },
        { new: true }
      );
    } else {
      updatedSession = await ChallengeSession.findOneAndUpdate(
        { 
          _id: session._id, 
          status: 'active',
          'solvedQuestions.questionId': { $ne: solvedObj.questionId }
        },
        { 
          $push: { solvedQuestions: solvedObj } 
        },
        { new: true }
      );
    }

    if (!updatedSession) {
      throw new AppError(ErrorCatalog.CTF_ALREADY_SOLVED, 'Ushbu savol allaqachon yechilgan.');
    }

    session = updatedSession;

    if (mode === 'hackathon') {
      // Award points to team
      await Team.findByIdAndUpdate(team._id, {
        $inc: { points: scoreAwarded }
      });

      // Award points and update stats for all team members
      await User.updateMany(
        { _id: { $in: team.members } },
        { 
          $inc: { 
            points: scoreAwarded,
            'statistics.pointsEarned': scoreAwarded
          },
          $set: { lastActive: new Date() }
        }
      );

      // Emit team score update
      emitToTeam(team._id.toString(), 'team:score', {
        teamId: team._id.toString(),
        points: team.points + scoreAwarded,
        stars: team.stars
      });
    } else {
      // Update user stats
      await User.findByIdAndUpdate(userId, {
        $inc: {
          points: scoreAwarded,
          'statistics.pointsEarned': scoreAwarded
        }
      });
    }

    await LeaderboardService.recalculateUserRankings();
    if (mode === 'hackathon') {
      await LeaderboardService.recalculateTeamRankings();
      emitToGlobal('leaderboard:refresh', {});
    }

    // Audit success
    await AuditLog.create({
      userId,
      teamId: team ? team._id : null,
      action: 'SUBMIT_QUESTION_SUCCESS',
      status: 'success',
      details: { challengeId, questionId, scoreAwarded },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    // Socket broadcasts
    const solveData = {
      teamName: team ? team.name : req.user.username,
      challengeTitle: challenge.title,
      questionTitle: question.title,
      points: scoreAwarded,
      solvedAt: new Date()
    };

    emitToGlobal('challenge:question_solved', solveData);
    if (mode === 'hackathon') {
      emitToTeam(team._id.toString(), 'team:score_update', { points: scoreAwarded });
    }

    res.status(200).json({
      success: true,
      message: mode === 'hackathon' ? 'Correct answer! Points added to team score.' : 'Correct answer! Points added to your profile.',
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
    const userId = req.user.userId;

    const precheck = await checkCTFStartAndStatus(challengeId, userId, res);
    if (!precheck) return;
    const { challenge, mode, team } = precheck;

    let session = null;
    if (mode === 'hackathon') {
      session = await TeamChallenge.findOne({ teamId: team._id, challengeId, status: 'active' });
    } else {
      session = await ChallengeSession.findOne({ userId, challengeId, status: 'active' });
    }

    if (!session) {
      throw new AppError(ErrorCatalog.CTF_SESSION_NOT_FOUND);
    }

    if (new Date() > session.expiresAt) {
      session.status = 'expired';
      await session.save();
      throw new AppError(ErrorCatalog.CTF_SESSION_EXPIRED);
    }

    const index = parseInt(flagIndex, 10);
    if (isNaN(index)) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Invalid flag index');
    }
    if (challenge.status === 'finished') {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Ushbu topshiriq yakunlangan va flaglar qabul qilinmaydi.');
    }
    const hackathon = await Hackathon.findOne({
      challenges: challengeId,
      status: 'finished'
    });
    if (hackathon) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Ushbu xakaton yakunlangan va flaglar qabul qilinmaydi.');
    }

    if (index < 0 || index >= challenge.flags.length) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Flag index out of range');
    }

    // Check if user has exceeded attempts for this specific flag
    let faIndex = session.flagAttempts.findIndex(fa => fa.flagIndex === index);
    if (faIndex === -1) {
      session.flagAttempts.push({ flagIndex: index, failedAttempts: 0 });
      faIndex = session.flagAttempts.length - 1;
    }
    if (session.flagAttempts[faIndex].failedAttempts >= 5) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Ushbu flag uchun maksimal urinishlar sonidan oshib ketildi (5 ta xato urinish). Flag bloklandi.');
    }

    // Check if challenge is already solved in the permanent solves record
    let isSolvedRecord = false;
    if (mode === 'hackathon') {
      isSolvedRecord = await ChallengeSolve.exists({ teamId: team._id, challengeId });
    } else {
      isSolvedRecord = await ChallengeSolve.exists({ userId, challengeId });
    }
    if (isSolvedRecord) {
      throw new AppError(ErrorCatalog.CTF_ALREADY_SOLVED, 'Ushbu topshiriq allaqachon yechilgan.');
    }

    // Check if flag index is already solved
    const alreadySolved = session.solvedFlags.some(sf => sf.flagIndex === index);
    if (alreadySolved) {
      throw new AppError(ErrorCatalog.CTF_ALREADY_SOLVED, 'Flag already verified');
    }

    // Verify flag (bcrypt comparison supporting both string and object flags)
    const targetFlagObj = challenge.flags[index];
    if (!targetFlagObj) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Flag index not found in challenge definition');
    }
    const targetFlagHash = typeof targetFlagObj === 'object' && targetFlagObj !== null ? targetFlagObj.flag : targetFlagObj;
    
    // Dynamic score calculation: Each challenge awards only its own score value.
    // So each flag awards a portion of the challenge's overall score after subtracting question points.
    const sumQuestionsPoints = challenge.questions.reduce((sum, q) => sum + (q.points !== undefined ? q.points : 10), 0);
    const flagsTotalPoints = Math.max(0, challenge.points - sumQuestionsPoints);
    const flagPoints = Math.round(flagsTotalPoints / challenge.flags.length);

    const isMatch = await bcrypt.compare(flag, targetFlagHash);
    if (!isMatch) {
      session.flagAttempts[faIndex].failedAttempts += 1;
      session.failedAttempts = (session.failedAttempts || 0) + 1;
      await session.save();

      await AuditLog.create({
        userId,
        teamId: team ? team._id : null,
        action: 'SUBMIT_FLAG_FAILURE',
        status: 'failure',
        details: { challengeId, flagIndex: index, failedAttempts: session.flagAttempts[faIndex].failedAttempts },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
      throw new AppError(ErrorCatalog.CTF_FLAG_INCORRECT, `Incorrect flag. Ushbu flag uchun urinishlar: ${session.flagAttempts[faIndex].failedAttempts}/5`);
    }

    const isFlagHintUnlocked = session.flagHintsUnlocked && session.flagHintsUnlocked.includes(index);
    const flagPointsAwarded = isFlagHintUnlocked ? Math.round(flagPoints * 0.8) : flagPoints;

    // Record solved flag
    const solvedObj = {
      flagIndex: index,
      pointsAwarded: flagPointsAwarded,
      solvedAt: new Date()
    };

    let updatedSession;
    if (mode === 'hackathon') {
      updatedSession = await TeamChallenge.findOneAndUpdate(
        { 
          _id: session._id, 
          status: 'active',
          'solvedFlags.flagIndex': { $ne: index }
        },
        { 
          $push: { solvedFlags: solvedObj } 
        },
        { new: true }
      );
    } else {
      updatedSession = await ChallengeSession.findOneAndUpdate(
        { 
          _id: session._id, 
          status: 'active',
          'solvedFlags.flagIndex': { $ne: index }
        },
        { 
          $push: { solvedFlags: solvedObj } 
        },
        { new: true }
      );
    }

    if (!updatedSession) {
      throw new AppError(ErrorCatalog.CTF_ALREADY_SOLVED, 'Ushbu flag allaqachon yechilgan.');
    }

    session = updatedSession;

    // Award points immediately
    if (mode === 'hackathon') {
      await Team.findByIdAndUpdate(team._id, {
        $inc: { points: flagPointsAwarded }
      });

      await User.updateMany(
        { _id: { $in: team.members } },
        { 
          $inc: { 
            points: flagPointsAwarded,
            'statistics.pointsEarned': flagPointsAwarded
          },
          $set: { lastActive: new Date() }
        }
      );

      emitToTeam(team._id.toString(), 'team:score', { 
        teamId: team._id.toString(),
        points: team.points + flagPointsAwarded,
        stars: team.stars
      });
    } else {
      await User.findByIdAndUpdate(userId, {
        $inc: {
          points: flagPointsAwarded,
          'statistics.pointsEarned': flagPointsAwarded
        }
      });
    }

    // Check if all flags are solved
    const solvedIndexes = session.solvedFlags.map(sf => sf.flagIndex);
    const allFlagsSolved = challenge.flags.every((_, i) => (solvedIndexes.includes(i) || i === index));
    let fullyCompleted = false;

    if (allFlagsSolved) {
      let completedSession;
      if (mode === 'hackathon') {
        completedSession = await TeamChallenge.findOneAndUpdate(
          { _id: session._id, status: 'active' },
          { $set: { status: 'completed' } },
          { new: true }
        );
      } else {
        completedSession = await ChallengeSession.findOneAndUpdate(
          { _id: session._id, status: 'active' },
          { $set: { status: 'completed' } },
          { new: true }
        );
      }

      if (completedSession) {
        session = completedSession;
        fullyCompleted = true;

        // Create permanent solve record
        await ChallengeSolve.create({
          userId,
          teamId: team ? team._id : null,
          challengeId,
          pointsAwarded: 
            session.solvedFlags.reduce((sum, sf) => sum + (sf.pointsAwarded || 0), 0) +
            session.solvedQuestions.reduce((sum, sq) => sum + (sq.pointsAwarded || 0), 0),
          solvedFlagsCount: session.solvedFlags.length,
          solvedQuestionsCount: session.solvedQuestions.length,
          totalSolved: session.solvedFlags.length + session.solvedQuestions.length
        }).catch(err => {
          console.error('ChallengeSolve creation error:', err);
        });

        if (mode === 'hackathon') {
          await Team.findByIdAndUpdate(team._id, {
            $inc: { stars: challenge.stars },
            $set: { finishTime: new Date() }
          });

          const statsField = `${challenge.difficulty}Solved`;
          for (const memberId of team.members) {
            const member = await User.findById(memberId);
            if (!member) continue;

            const memberAlreadyCompleted = member.completedCtfs && member.completedCtfs.some(id => id.toString() === challengeId.toString());

            const updateData = {
              $set: { lastActive: new Date(), finishTime: new Date() },
              $inc: {
                stars: challenge.stars,
                'statistics.starsEarned': challenge.stars,
                'statistics.hackathonsJoined': 1
              }
            };

            if (!memberAlreadyCompleted) {
              updateData.$addToSet = { completedCtfs: challengeId };
              updateData.$inc['statistics.totalSolved'] = 1;
              updateData.$inc[`statistics.${statsField}`] = 1;
            }

            await User.findByIdAndUpdate(memberId, updateData);
          }

          const currentHackathon = await Hackathon.findOne({ challenges: challengeId });
          if (currentHackathon) {
            await LeaderboardService.updateTeamFinishTime(team._id, currentHackathon._id);
          }

          emitToTeam(team._id.toString(), 'team:score', { 
            teamId: team._id.toString(),
            points: team.points + flagPointsAwarded,
            stars: team.stars + challenge.stars
          });
        } else {
          const user = await User.findById(userId);
          if (user) {
            const alreadyCompleted = user.completedCtfs && user.completedCtfs.some(id => id.toString() === challengeId.toString());
            const statsField = `${challenge.difficulty}Solved`;
            const updateData = {
              $set: { finishTime: new Date() },
              $inc: {
                stars: challenge.stars,
                'statistics.starsEarned': challenge.stars
              }
            };

            if (!alreadyCompleted) {
              updateData.$addToSet = { completedCtfs: challengeId };
              updateData.$inc['statistics.totalSolved'] = 1;
              updateData.$inc[`statistics.${statsField}`] = 1;
            }

            await User.findByIdAndUpdate(userId, updateData);
          }
        }

        await LeaderboardService.recalculateUserRankings();
        if (mode === 'hackathon') {
          await LeaderboardService.recalculateTeamRankings();
          emitToGlobal('leaderboard:refresh', {});
        }

        await AuditLog.create({
          userId,
          teamId: team ? team._id : null,
          action: 'CHALLENGE_COMPLETE',
          status: 'success',
          details: { challengeId, starsAwarded: challenge.stars },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        });
      }
    }

    await AuditLog.create({
      userId,
      teamId: team ? team._id : null,
      action: 'SUBMIT_FLAG_SUCCESS',
      status: 'success',
      details: { challengeId, flagIndex: index, pointsAwarded: flagPointsAwarded },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    const solveData = {
      teamName: team ? team.name : req.user.username,
      challengeTitle: challenge.title,
      questionTitle: `Flag ${index + 1}`,
      points: flagPointsAwarded,
      stars: fullyCompleted ? challenge.stars : 0,
      solvedAt: new Date()
    };
    emitToGlobal('challenge:solved', solveData);

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
    const userId = req.user.userId;

    const precheck = await checkCTFStartAndStatus(challengeId, userId, res);
    if (!precheck) return;
    const { challenge, mode, team } = precheck;

    let session = null;
    if (mode === 'hackathon') {
      session = await TeamChallenge.findOne({ teamId: team._id, challengeId });
    } else {
      session = await ChallengeSession.findOne({ userId, challengeId });
    }

    if (!session) {
      throw new AppError(ErrorCatalog.CTF_SESSION_NOT_FOUND);
    }

    if (session.status === 'completed') {
      return res.status(200).json({
        success: true,
        message: 'Challenge finished successfully! Stars have been awarded.',
        data: {
          fullyCompleted: true
        }
      });
    }

    if (session.status !== 'active') {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Sessiya allaqachon yakunlangan yoki muddati tugagan.');
    }

    const solvedIndexes = session.solvedFlags.map(sf => sf.flagIndex);
    const allFlagsSolved = challenge.flags.every((_, i) => solvedIndexes.includes(i));
    if (!allFlagsSolved) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Topshiriqni yakunlash uchun barcha flaglar yechilgan bo\'lishi kerak.');
    }

    // Complete session atomically
    let updateResult;
    if (mode === 'hackathon') {
      updateResult = await TeamChallenge.updateOne(
        { _id: session._id, status: 'active' },
        { $set: { status: 'completed' } }
      );
    } else {
      updateResult = await ChallengeSession.updateOne(
        { _id: session._id, status: 'active' },
        { $set: { status: 'completed' } }
      );
    }

    if (updateResult.modifiedCount === 0) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Sessiya allaqachon yakunlangan yoki muddati tugagan.');
    }

    session.status = 'completed';
    await session.save();

    if (mode === 'hackathon') {
      await Team.findByIdAndUpdate(team._id, {
        $inc: { stars: challenge.stars }
      });

      const statsField = `${challenge.difficulty}Solved`;
      for (const memberId of team.members) {
        const member = await User.findById(memberId);
        if (!member) continue;

        const memberAlreadyCompleted = member.completedCtfs && member.completedCtfs.some(id => id.toString() === challengeId.toString());

        const updateData = {
          $set: { lastActive: new Date() },
          $inc: {
            stars: challenge.stars,
            'statistics.starsEarned': challenge.stars,
            'statistics.hackathonsJoined': 1
          }
        };

        if (!memberAlreadyCompleted) {
          updateData.$addToSet = { completedCtfs: challengeId };
          updateData.$inc['statistics.totalSolved'] = 1;
          updateData.$inc[`statistics.${statsField}`] = 1;
        }

        await User.findByIdAndUpdate(memberId, updateData);
      }

      emitToTeam(team._id.toString(), 'team:score', { 
        teamId: team._id.toString(),
        points: team.points,
        stars: team.stars + challenge.stars
      });
    } else {
      const user = await User.findById(userId);
      if (user) {
        const alreadyCompleted = user.completedCtfs && user.completedCtfs.some(id => id.toString() === challengeId.toString());
        const statsField = `${challenge.difficulty}Solved`;
        const updateData = {
          $inc: {
            stars: challenge.stars,
            'statistics.starsEarned': challenge.stars
          }
        };

        if (!alreadyCompleted) {
          updateData.$addToSet = { completedCtfs: challengeId };
          updateData.$inc['statistics.totalSolved'] = 1;
          updateData.$inc[`statistics.${statsField}`] = 1;
        }

        await User.findByIdAndUpdate(userId, updateData);
      }
    }

    await LeaderboardService.recalculateUserRankings();
    if (mode === 'hackathon') {
      await LeaderboardService.recalculateTeamRankings();
      emitToGlobal('leaderboard:refresh', {});
    }

    await AuditLog.create({
      userId,
      teamId: team ? team._id : null,
      action: 'CHALLENGE_COMPLETE',
      status: 'success',
      details: { challengeId, starsAwarded: challenge.stars, manualFinish: true },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    emitToGlobal('challenge:solved', {
      teamName: team ? team.name : req.user.username,
      challengeTitle: challenge.title,
      questionTitle: 'All Flags',
      points: 0,
      stars: challenge.stars,
      solvedAt: new Date()
    });

    // Create permanent solve record if not exists
    const hasSolve = await ChallengeSolve.exists({ userId, challengeId });
    if (!hasSolve) {
      await ChallengeSolve.create({
        userId,
        teamId: team ? team._id : null,
        challengeId,
        pointsAwarded: 
          session.solvedFlags.reduce((sum, sf) => sum + (sf.pointsAwarded || 0), 0) +
          session.solvedQuestions.reduce((sum, sq) => sum + (sq.pointsAwarded || 0), 0),
        solvedFlagsCount: session.solvedFlags.length,
        solvedQuestionsCount: session.solvedQuestions.length,
        totalSolved: session.solvedFlags.length + session.solvedQuestions.length
      }).catch(err => {});
    }

    res.status(200).json({
      success: true,
      message: 'Challenge finished successfully! Stars have been awarded.',
      data: {
        fullyCompleted: true
      }
    });
  } catch (error) {
    next(error);
  }
};

export const finishChallengeEarly = async (req, res, next) => {
  try {
    const { challengeId } = req.params;
    const userId = req.user.userId;

    const precheck = await checkCTFStartAndStatus(challengeId, userId, res);
    if (!precheck) return;
    const { challenge, mode, team } = precheck;

    let session = null;
    if (mode === 'hackathon') {
      session = await TeamChallenge.findOne({ teamId: team._id, challengeId, status: 'active' });
    } else {
      session = await ChallengeSession.findOne({ userId, challengeId, status: 'active' });
    }

    if (!session) {
      throw new AppError(ErrorCatalog.CTF_SESSION_NOT_FOUND);
    }

    if (new Date() > session.expiresAt) {
      session.status = 'expired';
      await session.save();
      throw new AppError(ErrorCatalog.CTF_SESSION_EXPIRED);
    }

    session.status = 'completed';
    session.finishedAt = new Date();
    await session.save();

    const totalPointsAwarded = 
      session.solvedFlags.reduce((sum, sf) => sum + (sf.pointsAwarded || 0), 0) +
      session.solvedQuestions.reduce((sum, sq) => sum + (sq.pointsAwarded || 0), 0);
    
    await ChallengeSolve.create({
      userId,
      teamId: team ? team._id : null,
      challengeId,
      pointsAwarded: totalPointsAwarded,
      solvedFlagsCount: session.solvedFlags.length,
      solvedQuestionsCount: session.solvedQuestions.length,
      totalSolved: session.solvedFlags.length + session.solvedQuestions.length
    }).catch(err => {
      console.error('ChallengeSolve creation error on finish early:', err);
    });

    if (mode === 'hackathon') {
      await Team.findByIdAndUpdate(team._id, {
        $set: { finishTime: new Date() }
      });

      await User.updateMany(
        { _id: { $in: team.members } },
        { $set: { finishTime: new Date() } }
      );

      const currentHackathon = await Hackathon.findOne({ challenges: challengeId });
      if (currentHackathon) {
        await LeaderboardService.updateTeamFinishTime(team._id, currentHackathon._id);
      }

      emitToTeam(team._id.toString(), 'team:score', { 
        teamId: team._id.toString(),
        points: team.points,
        stars: team.stars
      });
    } else {
      await User.findByIdAndUpdate(userId, {
        $set: { finishTime: new Date() }
      });
    }

    await LeaderboardService.recalculateUserRankings();
    if (mode === 'hackathon') {
      await LeaderboardService.recalculateTeamRankings();
      emitToGlobal('leaderboard:refresh', {});
    }

    await AuditLog.create({
      userId,
      teamId: team ? team._id : null,
      action: 'FINISH_CHALLENGE_EARLY',
      status: 'success',
      details: { challengeId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: 'Topshiriq muddatidan oldin yakunlandi.',
      data: {
        sessionId: session._id,
        status: session.status,
        finishedAt: session.finishedAt
      }
    });
  } catch (error) {
    next(error);
  }
};

export const openHint = async (req, res, next) => {
  try {
    const { challengeId } = req.body;
    if (!challengeId) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'challengeId is required');
    }
    const userId = req.user.userId;

    const precheck = await checkCTFStartAndStatus(challengeId, userId, res);
    if (!precheck) return;
    const { challenge, mode, team } = precheck;

    let session = null;
    if (mode === 'hackathon') {
      session = await TeamChallenge.findOne({ teamId: team._id, challengeId, status: 'active' });
    } else {
      session = await ChallengeSession.findOne({ userId, challengeId, status: 'active' });
    }

    if (!session) {
      throw new AppError(ErrorCatalog.CTF_SESSION_NOT_FOUND);
    }

    if (new Date() > session.expiresAt) {
      session.status = 'expired';
      await session.save();
      throw new AppError(ErrorCatalog.CTF_SESSION_EXPIRED);
    }

    let penalty = 0;
    let newScore = 0;

    if (session.hintOpened || session.hintUsed || session.penaltyApplied) {
      // Hint already opened, no penalty
      if (mode === 'hackathon') {
        newScore = team.points;
      } else {
        const user = await User.findById(userId);
        newScore = user.points;
      }
    } else {
      // Mark as opened
      if (mode === 'hackathon') {
        await TeamChallenge.updateOne(
          { _id: session._id, status: 'active' },
          { $set: { hintUsed: true, hintOpened: true, penaltyApplied: true } }
        );
      } else {
        await ChallengeSession.updateOne(
          { _id: session._id, status: 'active' },
          { $set: { hintUsed: true, hintOpened: true, penaltyApplied: true } }
        );
      }

      session.hintUsed = true;
      session.hintOpened = true;
      session.penaltyApplied = true;

      // Apply 20% penalty deduction on points earned so far in this session
      const questionsPoints = session.solvedQuestions.reduce((sum, sq) => sum + (sq.pointsAwarded || 0), 0);
      const flagsPoints = session.solvedFlags.reduce((sum, sf) => sum + (sf.pointsAwarded || 0), 0);
      const pointsEarned = questionsPoints + flagsPoints;
      penalty = Math.round(pointsEarned * 0.2);

      // Reduce the points awarded for previously solved questions & flags in the session
      session.solvedQuestions.forEach(sq => {
        sq.pointsAwarded = Math.round(sq.pointsAwarded * 0.8);
      });
      session.solvedFlags.forEach(sf => {
        sf.pointsAwarded = Math.round(sf.pointsAwarded * 0.8);
      });

      if (mode === 'hackathon') {
        // Deduct from Team
        const updatedTeam = await Team.findByIdAndUpdate(team._id, {
          $inc: { points: -penalty }
        }, { new: true });
        newScore = updatedTeam.points;

        // Deduct from all team members
        await User.updateMany(
          { _id: { $in: team.members } },
          { $inc: { 
            points: -penalty,
            'statistics.pointsEarned': -penalty
          } }
        );

        // Emit team score update
        emitToTeam(team._id.toString(), 'team:score', { 
          teamId: team._id.toString(),
          points: updatedTeam.points,
          stars: updatedTeam.stars
        });
        emitToTeam(team._id.toString(), 'team:score_update', { points: -penalty });
      } else {
        // Practice mode
        const updatedUser = await User.findByIdAndUpdate(userId, {
          $inc: {
            points: -penalty,
            'statistics.pointsEarned': -penalty
          }
        }, { new: true });
        newScore = updatedUser.points;
      }

      await session.save();

      await LeaderboardService.recalculateUserRankings();
      if (mode === 'hackathon') {
        await LeaderboardService.recalculateTeamRankings();
        emitToGlobal('leaderboard:refresh', {});
      }

      // Socket updates
      emitToGlobal('hint:opened', { challengeId, userId, teamId: team ? team._id : null });
      emitToGlobal('score:update', { userId, teamId: team ? team._id : null, newScore });
    }

    // Get updated leaderboard
    let updatedLeaderboard = [];
    if (mode === 'hackathon') {
      const hackathon = await Hackathon.findOne({ challenges: challengeId });
      if (hackathon) {
        const leaderboardData = await LeaderboardService.getHackathonLeaderboard(hackathon._id, team ? team._id : null);
        updatedLeaderboard = leaderboardData ? leaderboardData.leaderboard : [];
      }
    } else {
      const userLeaderboardData = await LeaderboardService.getUserLeaderboard(userId);
      updatedLeaderboard = userLeaderboardData ? userLeaderboardData.leaderboard : [];
    }

    await AuditLog.create({
      userId,
      teamId: team ? team._id : null,
      action: 'UNLOCK_CHALLENGE_HINT',
      status: 'success',
      details: { challengeId, penaltyApplied: penalty },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: 'Hint unlocked successfully.',
      data: {
        newScore,
        penalty,
        updatedLeaderboard,
        hint: challenge.hint
      }
    });
  } catch (error) {
    next(error);
  }
};
