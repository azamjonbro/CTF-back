import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/token.js';
import { AppError, ErrorCatalog } from '../utils/errors.js';
import BlacklistedToken from '../models/BlacklistedToken.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { LeaderboardService } from '../services/leaderboardService.js';
import Captcha from '../models/Captcha.js';

// Parse UserAgent into readable Device/OS/Browser info
const getDeviceInfo = (userAgentHeader, ip) => {
  const ua = userAgentHeader || '';
  let os = 'Unknown OS';
  let browser = 'Unknown Browser';

  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Macintosh')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone')) os = 'iOS';

  if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('Edge')) browser = 'Edge';

  return {
    os,
    browser,
    ip: ip || '127.0.0.1'
  };
};

export const getCaptcha = async (req, res, next) => {
  try {
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    const operators = ['+', '-', '*'];
    const operator = operators[Math.floor(Math.random() * operators.length)];

    let answer;
    if (operator === '+') answer = num1 + num2;
    else if (operator === '-') answer = num1 - num2;
    else if (operator === '*') answer = num1 * num2;

    const captcha = new Captcha({ answer });
    await captcha.save();

    res.status(200).json({
      success: true,
      data: {
        captchaId: captcha._id,
        question: `${num1} ${operator} ${num2} = ?`
      }
    });
  } catch (error) {
    next(error);
  }
};

export const register = async (req, res, next) => {
  try {
    const { username, email, password, name, surname, age, country, captchaId, captchaAnswer } = req.body;

    if (process.env.NODE_ENV !== 'test') {
      if (!captchaId || captchaAnswer === undefined || captchaAnswer === '') {
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Matematik captcha to\'ldirilishi shart.');
      }
      const captcha = await Captcha.findById(captchaId);
      if (!captcha) {
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Captcha muddati tugagan yoki noto\'g\'ri.');
      }
      if (parseInt(captchaAnswer, 10) !== captcha.answer) {
        await Captcha.findByIdAndDelete(captchaId);
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Captcha javobi noto\'g\'ri.');
      }
      await Captcha.findByIdAndDelete(captchaId);
    }

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      throw new AppError(ErrorCatalog.USER_ALREADY_EXISTS);
    }

    const newUser = new User({
      username,
      email,
      passwordHash: password, // Pre-save hooks will encrypt
      name,
      surname,
      age,
      country,
      roles: ['team_member'] // Default role
    });

    await newUser.save();

    // Recalculate rankings so the user gets an actual rank instead of 999999 immediately
    await LeaderboardService.recalculateUserRankings();

    // Log Activity
    await AuditLog.create({
      userId: newUser._id,
      action: 'REGISTER',
      status: 'success',
      details: { username: newUser.username },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful. You can now log in.'
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const { usernameOrEmail, password, deviceName, captchaId, captchaAnswer } = req.body;

    if (process.env.NODE_ENV !== 'test') {
      if (!captchaId || captchaAnswer === undefined || captchaAnswer === '') {
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Matematik captcha to\'ldirilishi shart.');
      }
      const captcha = await Captcha.findById(captchaId);
      if (!captcha) {
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Captcha muddati tugagan yoki noto\'g\'ri.');
      }
      if (parseInt(captchaAnswer, 10) !== captcha.answer) {
        await Captcha.findByIdAndDelete(captchaId);
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Captcha javobi noto\'g\'ri.');
      }
      await Captcha.findByIdAndDelete(captchaId);
    }

    const user = await User.findOne({
      $or: [{ username: usernameOrEmail.toLowerCase() }, { email: usernameOrEmail.toLowerCase() }]
    });

    if (!user || !(await user.comparePassword(password))) {
      // Log failed audit log
      await AuditLog.create({
        action: 'LOGIN',
        status: 'failure',
        details: { attempt: usernameOrEmail },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
      throw new AppError(ErrorCatalog.AUTH_INVALID_CREDENTIALS);
    }

    // Generate unique device session
    const deviceId = crypto.randomBytes(16).toString('hex');
    const { os, browser, ip } = getDeviceInfo(req.headers['user-agent'], req.ip);

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user, deviceId);

    // Update devices sessions in user record
    user.devices.push({
      deviceId,
      name: deviceName || `${browser} on ${os}`,
      os,
      browser,
      ip,
      lastActive: new Date()
    });

    // Ensure we don't store unbounded sessions (e.g. max 5 concurrent devices, remove oldest)
    if (user.devices.length > 5) {
      user.devices.shift();
    }

    user.lastActive = new Date();
    await user.save();

    // Log successful audit log
    await AuditLog.create({
      userId: user._id,
      action: 'LOGIN',
      status: 'success',
      details: { deviceId, device: deviceName },
      ipAddress: ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          name: user.name,
          surname: user.surname,
          roles: user.roles,
          points: user.points,
          stars: user.stars,
          ranking: user.ranking,
          profilePicture: user.profilePicture
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      throw new AppError(ErrorCatalog.AUTH_REFRESH_EXPIRED);
    }

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      throw new AppError(ErrorCatalog.AUTH_REFRESH_EXPIRED);
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      throw new AppError(ErrorCatalog.USER_NOT_FOUND);
    }

    // Ensure the device session is still active
    const deviceSessionIndex = user.devices.findIndex(d => d.deviceId === decoded.deviceId);
    if (deviceSessionIndex === -1) {
      throw new AppError(ErrorCatalog.AUTH_SESSION_REVOKED);
    }

    // Rotate Tokens: generate fresh new ones
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user, decoded.deviceId);

    // Update active device last active date
    user.devices[deviceSessionIndex].lastActive = new Date();
    user.lastActive = new Date();
    await user.save();

    res.status(200).json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader.split(' ')[1];
    const decodedAccessToken = jwt.decode(token);

    // Blacklist access token in Redis until it naturally expires
    if (decodedAccessToken && decodedAccessToken.exp) {
      const expiresAt = new Date(decodedAccessToken.exp * 1000);
      await BlacklistedToken.create({ token, expiresAt }).catch(() => {}); // catch duplicates gracefully
    }

    // Decode refresh token if supplied to remove device session
    const { refreshToken } = req.body;
    if (refreshToken) {
      const decodedRefresh = verifyRefreshToken(refreshToken);
      if (decodedRefresh) {
        await User.updateOne(
          { _id: decodedRefresh.userId },
          { $pull: { devices: { deviceId: decodedRefresh.deviceId } } }
        );
      }
    }

    res.status(200).json({
      success: true,
      message: 'Successfully logged out.'
    });
  } catch (error) {
    next(error);
  }
};

export const logoutAll = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    if (user) {
      user.devices = [];
      await user.save();
    }

    // Add current token to blacklist
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.split(' ')[1];
      const decodedAccessToken = jwt.decode(token);
      if (decodedAccessToken && decodedAccessToken.exp) {
        const expiresAt = new Date(decodedAccessToken.exp * 1000);
        await BlacklistedToken.create({ token, expiresAt }).catch(() => {});
      }
    }

    res.status(200).json({
      success: true,
      message: 'Logged out of all sessions successfully.'
    });
  } catch (error) {
    next(error);
  }
};

export const getSessions = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId).select('devices');
    if (!user) {
      throw new AppError(ErrorCatalog.USER_NOT_FOUND);
    }

    res.status(200).json({
      success: true,
      data: user.devices
    });
  } catch (error) {
    next(error);
  }
};
