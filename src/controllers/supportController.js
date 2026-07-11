import CTF from '../models/CTF.js';
import AuditLog from '../models/AuditLog.js';
import { AppError, ErrorCatalog } from '../utils/errors.js';
import { scanForViruses } from '../middlewares/upload.js';
import bcrypt from 'bcryptjs';

const isBcryptHash = (str) => typeof str === 'string' && /^\$2[ayb]\$[0-9]{2}\$[./A-Za-z0-9]{53}$/.test(str);

export const addQuestionToChallenge = async (req, res, next) => {
  try {
    const { challengeId } = req.params;
    const { title, description, points, correctAnswer, hint, type, options } = req.body;

    const challenge = await CTF.findById(challengeId);
    if (!challenge) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
    }

    let answerValue = correctAnswer;
    if (!isBcryptHash(answerValue)) {
      const salt = await bcrypt.genSalt(10);
      answerValue = await bcrypt.hash(answerValue, salt);
    }

    challenge.questions.push({
      title,
      description,
      correctAnswer: answerValue,
      points: points !== undefined ? points : 10,
      hint: hint || '',
      type: type || 'text',
      options: options || []
    });

    await challenge.save();

    await AuditLog.create({
      userId: req.user.userId,
      action: 'ADD_QUESTION',
      status: 'success',
      details: { challengeId, title },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(201).json({
      success: true,
      message: 'Question added to challenge successfully.',
      data: challenge.questions[challenge.questions.length - 1]
    });
  } catch (error) {
    next(error);
  }
};

// Upload files/images/binaries to serve as attachments
export const uploadAttachment = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError(ErrorCatalog.SYSTEM_FILE_UPLOAD_FAILED, 'No file uploaded');
    }

    const filePath = req.file.path;
    
    // Secure Virus Scan phase
    const isClean = await scanForViruses(filePath);
    if (!isClean) {
      throw new AppError(ErrorCatalog.SYSTEM_FILE_UPLOAD_FAILED, 'File rejected: malicious signature found.');
    }

    res.status(200).json({
      success: true,
      message: 'Resource file uploaded successfully.',
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        // Relative path to be served statically by Express
        url: `/uploads/${req.file.filename}`
      }
    });
  } catch (error) {
    next(error);
  }
};
