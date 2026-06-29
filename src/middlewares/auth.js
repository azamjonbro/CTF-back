import { verifyAccessToken } from '../utils/token.js';
import BlacklistedToken from '../models/BlacklistedToken.js';
import { AppError, ErrorCatalog } from '../utils/errors.js';
import User from '../models/User.js';
import Team from '../models/Team.js';

// Protect endpoints and verify authorization
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(ErrorCatalog.AUTH_UNAUTHORIZED);
    }

    const token = authHeader.split(' ')[1];
    
    // Check if token is blacklisted in MongoDB
    const isBlacklisted = await BlacklistedToken.findOne({ token });
    if (isBlacklisted) {
      throw new AppError(ErrorCatalog.AUTH_SESSION_REVOKED);
    }

    const decoded = verifyAccessToken(token);
    if (!decoded) {
      throw new AppError(ErrorCatalog.AUTH_TOKEN_EXPIRED);
    }

    // Attach user payload to request
    req.user = decoded;
    next();
  } catch (error) {
    next(error);
  }
};

// Role-based access control middleware
export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new AppError(ErrorCatalog.AUTH_UNAUTHORIZED);
      }

      // Check if user has at least one of the allowed roles
      const hasRole = req.user.roles.some(role => allowedRoles.includes(role));
      if (!hasRole) {
        throw new AppError(ErrorCatalog.AUTH_FORBIDDEN);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Check if user is associated with any active team
export const requireTeam = async (req, res, next) => {
  try {
    if (!req.user) {
      throw new AppError(ErrorCatalog.AUTH_UNAUTHORIZED);
    }

    const team = await Team.findOne({ members: req.user.userId });
    if (!team) {
      throw new AppError(ErrorCatalog.TEAM_NOT_FOUND, 'You must join or create a team to access this feature.');
    }

    req.team = team;
    next();
  } catch (error) {
    next(error);
  }
};

// Optional authentication middleware that doesn't block the request if token is missing/invalid
export const optionalAuthenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const isBlacklisted = await BlacklistedToken.findOne({ token });
      if (!isBlacklisted) {
        const decoded = verifyAccessToken(token);
        if (decoded) {
          req.user = decoded;
        }
      }
    }
    next();
  } catch (error) {
    next();
  }
};

