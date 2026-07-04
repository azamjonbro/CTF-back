import CTF from '../models/CTF.js';
import Team from '../models/Team.js';
import User from '../models/User.js';
import Hackathon from '../models/Hackathon.js';
import ChallengeSession from '../models/ChallengeSession.js';
import TeamChallenge from '../models/TeamChallenge.js';
import AuditLog from '../models/AuditLog.js';
import { AppError, ErrorCatalog } from '../utils/errors.js';

import { LeaderboardService } from '../services/leaderboardService.js';
import { emitToGlobal, emitToTeam, emitToHackathon } from '../config/socket.js';
import bcrypt from 'bcryptjs';

const getChallengeMode = async (challengeId) => {
  const hackathon = await Hackathon.findOne({
    challenges: challengeId,
    status: { $in: ['open', 'closed', 'running'] }
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

    const mode = await getChallengeMode(challengeId);
    let session = null;

    if (mode === 'hackathon') {
      const team = await Team.findOne({ members: userId });
      const teamId = team ? team._id : null;
      if (teamId) {
        session = await TeamChallenge.findOne({ teamId, challengeId });
      }
    } else {
      session = await ChallengeSession.findOne({ userId, challengeId });
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
            flagsCount: challenge.flags.length,
            hasHint: !!challenge.hint
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

    if (mode === 'hackathon') {
      const team = await Team.findOne({ members: userId });
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

    const mode = await getChallengeMode(challengeId);
    let session = null;
    let team = null;

    if (mode === 'hackathon') {
      team = await Team.findOne({ members: userId });
      if (!team) {
        throw new AppError(ErrorCatalog.HACKATHON_TEAM_NOT_REGISTERED, 'Xakaton topshiriqlarini bajarish uchun jamoada bo\'lishingiz shart.');
      }
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

    const challenge = await CTF.findById(challengeId);
    if (!challenge) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
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

    // Unlock hint
    session.hintsUnlocked.push({ questionId, hintIndex: 0 });

    // Increment hints used statistic for current user
    await User.findByIdAndUpdate(userId, {
      $inc: { 'statistics.hintsUsed': 1 }
    });

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

export const unlockChallengeHint = async (req, res, next) => {
  try {
    const { challengeId } = req.params;
    const userId = req.user.userId;

    const mode = await getChallengeMode(challengeId);
    let session = null;
    let team = null;

    if (mode === 'hackathon') {
      team = await Team.findOne({ members: userId });
      if (!team) {
        throw new AppError(ErrorCatalog.HACKATHON_TEAM_NOT_REGISTERED, 'Xakaton topshiriqlarini bajarish uchun jamoada bo\'lishingiz shart.');
      }
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

    const challenge = await CTF.findById(challengeId);
    if (!challenge) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
    }

    if (session.hintUsed) {
      return res.status(200).json({
        success: true,
        message: 'Hint already unlocked.',
        data: { hint: challenge.hint }
      });
    }

    session.hintUsed = true;

    // Apply 20% penalty deduction on points earned so far in this session
    const pointsEarned = session.solvedQuestions.reduce((sum, sq) => sum + (sq.pointsAwarded || 0), 0);
    const penalty = Math.round(pointsEarned * 0.2);

    if (penalty > 0) {
      // Reduce the points awarded for previously solved questions in the session
      session.solvedQuestions.forEach(sq => {
        sq.pointsAwarded = Math.round(sq.pointsAwarded * 0.8);
      });

      if (mode === 'hackathon') {
        // Deduct from Team
        await Team.findByIdAndUpdate(team._id, {
          $inc: { points: -penalty }
        });

        // Deduct from all team members
        await User.updateMany(
          { _id: { $in: team.members } },
          { $inc: { points: -penalty } }
        );

        // Emit team score update
        emitToTeam(team._id.toString(), 'team:score_update', { points: -penalty });
      }

      // Deduct from current user statistics
      await User.findByIdAndUpdate(userId, {
        $inc: { 'statistics.pointsEarned': -penalty }
      });

      await LeaderboardService.recalculateUserRankings();
      if (mode === 'hackathon') {
        await LeaderboardService.recalculateTeamRankings();
      }
    }

    // Increment hints used statistic for current user
    await User.findByIdAndUpdate(userId, {
      $inc: { 'statistics.hintsUsed': 1 }
    });

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

    const mode = await getChallengeMode(challengeId);
    let session = null;
    let team = null;

    if (mode === 'hackathon') {
      team = await Team.findOne({ members: userId });
      if (!team) {
        throw new AppError(ErrorCatalog.HACKATHON_TEAM_NOT_REGISTERED, 'Xakaton topshiriqlarini bajarish uchun jamoada bo\'lishingiz shart.');
      }
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

    const challenge = await CTF.findById(challengeId);
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

    const originalScore = question.points !== undefined ? question.points : 10;
    const isQuestionHintUnlocked = session.hintsUnlocked.some(hu => hu.questionId.toString() === questionId);
    const scoreAwarded = isQuestionHintUnlocked ? Math.round(originalScore * 0.8) : originalScore;

    session.solvedQuestions.push({
      questionId,
      pointsAwarded: scoreAwarded,
      solvedAt: new Date()
    });

    await session.save();

    if (mode === 'hackathon') {
      // Award points to team
      await Team.findByIdAndUpdate(team._id, {
        $inc: { points: scoreAwarded }
      });

      // Award points to all team members
      await User.updateMany(
        { _id: { $in: team.members } },
        { 
          $inc: { points: scoreAwarded },
          $set: { lastActive: new Date() }
        }
      );
    }

    // Update user stats (do not increment totalSolved / difficulty solved here)
    await User.findByIdAndUpdate(userId, {
      $inc: {
        points: mode === 'practice' ? scoreAwarded : 0,
        'statistics.pointsEarned': scoreAwarded
      }
    });

    await LeaderboardService.recalculateUserRankings();
    if (mode === 'hackathon') {
      await LeaderboardService.recalculateTeamRankings();
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

    const mode = await getChallengeMode(challengeId);
    let session = null;
    let team = null;

    if (mode === 'hackathon') {
      team = await Team.findOne({ members: userId });
      if (!team) {
        throw new AppError(ErrorCatalog.HACKATHON_TEAM_NOT_REGISTERED, 'Xakaton topshiriqlarini bajarish uchun jamoada bo\'lishingiz shart.');
      }
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

    const challenge = await CTF.findById(challengeId);
    if (!challenge) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
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

    // Check if flag index is already solved
    const alreadySolved = session.solvedFlags.some(sf => sf.flagIndex === index);
    if (alreadySolved) {
      throw new AppError(ErrorCatalog.CTF_ALREADY_SOLVED, 'Flag already verified');
    }

    // Verify flag (bcrypt comparison)
    const isMatch = await bcrypt.compare(flag, challenge.flags[index]);
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

      const originalChallengePoints = challenge.points !== undefined ? challenge.points : 100;
      const challengePointsAwarded = session.hintUsed ? Math.round(originalChallengePoints * 0.8) : originalChallengePoints;

      if (mode === 'hackathon') {
        // Award stars and points to team
        await Team.findByIdAndUpdate(team._id, {
          $inc: { 
            stars: challenge.stars,
            points: challengePointsAwarded
          }
        });

        // Award stars and points to all team members
        await User.updateMany(
          { _id: { $in: team.members } },
          { 
            $inc: { 
              stars: challenge.stars,
              points: challengePointsAwarded
            },
            $set: { lastActive: new Date() }
          }
        );
      }

      // Update stats for the user
      const statsField = `${challenge.difficulty}Solved`;
      await User.findByIdAndUpdate(userId, {
        $inc: {
          stars: mode === 'practice' ? challenge.stars : 0,
          points: mode === 'practice' ? challengePointsAwarded : 0,
          'statistics.starsEarned': challenge.stars,
          'statistics.pointsEarned': challengePointsAwarded,
          'statistics.hackathonsJoined': mode === 'hackathon' ? 1 : 0,
          'statistics.totalSolved': 1,
          [`statistics.${statsField}`]: 1
        }
      });

      await LeaderboardService.recalculateUserRankings();
      if (mode === 'hackathon') {
        await LeaderboardService.recalculateTeamRankings();
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

    await session.save();

    await AuditLog.create({
      userId,
      teamId: team ? team._id : null,
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
    const userId = req.user.userId;

    const mode = await getChallengeMode(challengeId);
    let session = null;
    let team = null;

    if (mode === 'hackathon') {
      team = await Team.findOne({ members: userId });
      if (!team) {
        throw new AppError(ErrorCatalog.HACKATHON_TEAM_NOT_REGISTERED, 'Xakaton topshiriqlarini bajarish uchun jamoada bo\'lishingiz shart.');
      }
      session = await TeamChallenge.findOne({ teamId: team._id, challengeId });
    } else {
      session = await ChallengeSession.findOne({ userId, challengeId });
    }

    if (!session) {
      throw new AppError(ErrorCatalog.CTF_SESSION_NOT_FOUND);
    }

    if (session.status !== 'active') {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Sessiya allaqachon yakunlangan yoki muddati tugagan.');
    }

    const challenge = await CTF.findById(challengeId);
    if (!challenge) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
    }

    // Complete session
    session.status = 'completed';
    await session.save();

    const originalChallengePoints = challenge.points !== undefined ? challenge.points : 100;
    const challengePointsAwarded = session.hintUsed ? Math.round(originalChallengePoints * 0.8) : originalChallengePoints;

    if (mode === 'hackathon') {
      // Award stars and points to team
      await Team.findByIdAndUpdate(team._id, {
        $inc: { 
          stars: challenge.stars,
          points: challengePointsAwarded
        }
      });

      // Award stars and points to all team members
      await User.updateMany(
        { _id: { $in: team.members } },
        { 
          $inc: { 
            stars: challenge.stars,
            points: challengePointsAwarded
          },
          $set: { lastActive: new Date() }
        }
      );
    }

    // Update stats for the user
    const statsField = `${challenge.difficulty}Solved`;
    await User.findByIdAndUpdate(userId, {
      $inc: {
        stars: mode === 'practice' ? challenge.stars : 0,
        points: mode === 'practice' ? challengePointsAwarded : 0,
        'statistics.starsEarned': challenge.stars,
        'statistics.pointsEarned': challengePointsAwarded,
        'statistics.hackathonsJoined': mode === 'hackathon' ? 1 : 0,
        'statistics.totalSolved': 1,
        [`statistics.${statsField}`]: 1
      }
    });

    await LeaderboardService.recalculateUserRankings();
    if (mode === 'hackathon') {
      await LeaderboardService.recalculateTeamRankings();
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

    // WebSockets update
    const completeData = {
      teamName: team ? team.name : req.user.username,
      challengeTitle: challenge.title,
      stars: challenge.stars,
      completedAt: new Date()
    };

    emitToGlobal('challenge:completed', completeData);
    if (mode === 'hackathon') {
      emitToTeam(team._id.toString(), 'team:stars_update', { stars: challenge.stars });
    }

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
