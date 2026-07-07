import CTF from '../models/CTF.js';
import AuditLog from '../models/AuditLog.js';
import { AppError, ErrorCatalog } from '../utils/errors.js';
import bcrypt from 'bcryptjs';

const isBcryptHash = (str) => {
  return typeof str === 'string' && /^\$2[ayb]\$[0-9]{2}\$[./A-Za-z0-9]{53}$/.test(str);
};

// Helper to hash flags
const hashFlags = async (flags) => {
  const hashed = [];
  for (const f of flags) {
    let flagValue = f.flag;
    if (!isBcryptHash(flagValue)) {
      const salt = await bcrypt.genSalt(10);
      flagValue = await bcrypt.hash(flagValue, salt);
    }
    hashed.push({
      flag: flagValue,
      points: f.points !== undefined ? f.points : 100
    });
  }
  return hashed;
};

// Helper to hash question answers
const hashQuestions = async (questions) => {
  const processed = [];
  for (const q of questions) {
    let answerValue = q.answer;
    if (!isBcryptHash(answerValue)) {
      const salt = await bcrypt.genSalt(10);
      answerValue = await bcrypt.hash(answerValue, salt);
    }
    processed.push({
      title: q.title,
      description: q.description,
      answer: answerValue,
      points: q.points !== undefined ? q.points : 10,
      hint: q.hint || ''
    });
  }
  return processed;
};

export const createChallenge = async (req, res, next) => {
  try {
    const { title, shortDescription, longDescription, difficulty, stars, points, category, questions, timerMinutes, image, attachments, flags, hint } = req.body;

    const existing = await CTF.findOne({ title });
    if (existing) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'A challenge with this title already exists.');
    }

    // Securely hash flags and question answers
    const securedFlags = await hashFlags(flags || []);
    const securedQuestions = await hashQuestions(questions || []);

    const newChallenge = new CTF({
      title,
      shortDescription,
      longDescription,
      difficulty,
      stars,
      points: points !== undefined ? points : 100,
      category,
      timerMinutes: timerMinutes || 60,
      image: image || '',
      attachments: attachments || [],
      hint: hint || '',
      flags: securedFlags,
      questions: securedQuestions,
      author: req.user.userId,
      status: 'draft' // default status
    });

    await newChallenge.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: 'CREATE_CHALLENGE',
      status: 'success',
      details: { challengeId: newChallenge._id, title },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(201).json({
      success: true,
      message: 'CTF Challenge created successfully in draft mode.',
      data: {
        id: newChallenge._id,
        title: newChallenge.title,
        status: newChallenge.status
      }
    });
  } catch (error) {
    next(error);
  }
};

export const editChallenge = async (req, res, next) => {
  try {
    const { challengeId } = req.params;
    const { title, shortDescription, longDescription, difficulty, stars, points, category, questions, status, timerMinutes, image, attachments, flags, hint } = req.body;

    const challenge = await CTF.findById(challengeId);
    if (!challenge) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
    }

    // Verify ownership or admin rights
    const isAdmin = req.user.roles.includes('admin');
    const isAuthor = challenge.author.toString() === req.user.userId;
    if (!isAdmin && !isAuthor) {
      throw new AppError(ErrorCatalog.AUTH_FORBIDDEN, 'You can only edit your own challenges.');
    }

    if (title) challenge.title = title;
    if (shortDescription) challenge.shortDescription = shortDescription;
    if (longDescription) challenge.longDescription = longDescription;
    if (difficulty) challenge.difficulty = difficulty;
    if (stars) challenge.stars = stars;
    if (points !== undefined) challenge.points = points;
    if (category) challenge.category = category;
    if (status) challenge.status = status;
    if (timerMinutes !== undefined) challenge.timerMinutes = timerMinutes;
    if (image !== undefined) challenge.image = image;
    if (attachments !== undefined) challenge.attachments = attachments;
    if (hint !== undefined) challenge.hint = hint;

    if (flags) {
      challenge.flags = await hashFlags(flags);
    }

    if (questions) {
      challenge.questions = await hashQuestions(questions);
    }

    await challenge.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: 'EDIT_CHALLENGE',
      status: 'success',
      details: { challengeId, title: challenge.title },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: 'Challenge updated successfully.',
      data: challenge
    });
  } catch (error) {
    next(error);
  }
};

export const toggleChallengeStatus = async (req, res, next) => {
  try {
    const { challengeId } = req.params;
    const { status } = req.body; // 'active' | 'disabled' | 'draft'

    if (!['active', 'disabled', 'draft'].includes(status)) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Invalid status state');
    }

    const challenge = await CTF.findById(challengeId);
    if (!challenge) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
    }

    const isAdmin = req.user.roles.includes('admin');
    const isAuthor = challenge.author.toString() === req.user.userId;
    if (!isAdmin && !isAuthor) {
      throw new AppError(ErrorCatalog.AUTH_FORBIDDEN);
    }

    challenge.status = status;
    await challenge.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: 'TOGGLE_STATUS_CHALLENGE',
      status: 'success',
      details: { challengeId, status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: `Challenge status set to '${status}' successfully.`
    });
  } catch (error) {
    next(error);
  }
};

export const deleteChallenge = async (req, res, next) => {
  try {
    const { challengeId } = req.params;

    const challenge = await CTF.findById(challengeId);
    if (!challenge) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
    }

    // Verify ownership or admin rights
    const isAdmin = req.user.roles.includes('admin');
    const isAuthor = challenge.author.toString() === req.user.userId;
    if (!isAdmin && !isAuthor) {
      throw new AppError(ErrorCatalog.AUTH_FORBIDDEN, 'You can only delete your own challenges.');
    }

    await CTF.findByIdAndDelete(challengeId);

    await AuditLog.create({
      userId: req.user.userId,
      action: 'DELETE_CHALLENGE',
      status: 'success',
      details: { challengeId, title: challenge.title },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: 'Challenge deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};
