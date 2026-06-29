import CTF from '../models/CTF.js';
import AuditLog from '../models/AuditLog.js';
import { AppError, ErrorCatalog } from '../utils/errors.js';
import { scanForViruses } from '../middlewares/upload.js';
import bcrypt from 'bcryptjs';

export const addQuestionToChallenge = async (req, res, next) => {
  try {
    const { challengeId } = req.params;
    const { title, description, score, attachments, flags, hints, type } = req.body;

    const challenge = await CTF.findById(challengeId);
    if (!challenge) {
      throw new AppError(ErrorCatalog.CTF_NOT_FOUND);
    }

    if (challenge.questions.length >= 10) {
      throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'A challenge cannot contain more than 10 questions.');
    }

    // Encrypt the flags
    const hashedFlags = [];
    for (const flag of flags) {
      const salt = await bcrypt.genSalt(10);
      const hashed = await bcrypt.hash(flag, salt);
      hashedFlags.push(hashed);
    }

    challenge.questions.push({
      title,
      description,
      score,
      attachments,
      flags: hashedFlags,
      hints,
      type
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
