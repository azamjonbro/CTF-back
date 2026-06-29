import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';
import Team from '../models/Team.js';

let ioInstance = null;

export const initSocket = (server) => {
  ioInstance = new Server(server, {
    cors: {
      origin: '*', // Dynamic configurations can restrict this in production
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Authentication Middleware for Sockets
  ioInstance.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      if (!token) {
        return next(new Error('Authentication error: Token missing'));
      }

      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      socket.user = decoded;

      // Find user's team if exists
      const team = await Team.findOne({ members: decoded.userId });
      if (team) {
        socket.teamId = team._id.toString();
      }

      next();
    } catch (err) {
      logger.error(`Socket connection auth failure: ${err.message}`);
      return next(new Error('Authentication error: Invalid credentials'));
    }
  });

  ioInstance.on('connection', (socket) => {
    logger.info(`Socket connected: User [${socket.user.username}] Session [${socket.id}]`);

    // Join default rooms
    socket.join('global');

    if (socket.teamId) {
      socket.join(`team:${socket.teamId}`);
      logger.info(`Socket [${socket.id}] joined room team:${socket.teamId}`);
    }

    // Join hackathon room helper
    socket.on('join:hackathon', (hackathonId) => {
      socket.join(`hackathon:${hackathonId}`);
      logger.info(`Socket [${socket.id}] joined room hackathon:${hackathonId}`);
    });

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: Session [${socket.id}]`);
    });
  });

  return ioInstance;
};

// Global emitters for controllers
export const emitToGlobal = (event, data) => {
  if (ioInstance) {
    ioInstance.to('global').emit(event, data);
  }
};

export const emitToTeam = (teamId, event, data) => {
  if (ioInstance) {
    ioInstance.to(`team:${teamId}`).emit(event, data);
  }
};

export const emitToHackathon = (hackathonId, event, data) => {
  if (ioInstance) {
    ioInstance.to(`hackathon:${hackathonId}`).emit(event, data);
  }
};

export const getIoInstance = () => ioInstance;
