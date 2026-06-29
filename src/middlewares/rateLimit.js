import rateLimit from 'express-rate-limit';
import { AppError, ErrorCatalog } from '../utils/errors.js';

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // Relaxed limit to 10000 requests per window for active testing
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res, next) => {
    next(new AppError(ErrorCatalog.SYSTEM_RATE_LIMIT));
  }
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Relaxed limit to 1000 auth attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(new AppError(ErrorCatalog.SYSTEM_RATE_LIMIT, 'Too many authentication attempts. Please try again in 15 minutes.'));
  }
});
