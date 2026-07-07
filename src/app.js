import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Import Configurations & Utilities
import { connectDB } from './config/db.js';
import { initSocket } from './config/socket.js';
import { initCronJobs } from './config/cron.js';
import logger from './utils/logger.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { globalLimiter } from './middlewares/rateLimit.js';

// Import Route Handlers
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import teamRoutes from './routes/teamRoutes.js';
import ctfRoutes from './routes/ctfRoutes.js';
import hackathonRoutes from './routes/hackathonRoutes.js';
import leaderboardRoutes from './routes/leaderboardRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

// New API Updates (Requirement 8)
import { openHint } from './controllers/ctfController.js';
import { manuallyFinishChallenge, manuallyFinishHackathon } from './controllers/adminController.js';
import { getLeaderboardAndFinishTime } from './controllers/leaderboardController.js';
import { authenticate, requireRole } from './middlewares/auth.js';

// Init environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Establish Database Connections
connectDB();

// 2. Setup Security & Utilities Middlewares
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: '*', // Restrict to front & admin URLs in production env
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));
app.use(hpp()); // HTTP Parameter Pollution protection
app.use(globalLimiter); // Rate limit all requests
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Wire Morgan HTTP logging to winston streams
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.http(message.trim())
  }
}));

// Serve uploaded resource attachments statically
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// 3. API Routers Mount
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/teams', teamRoutes);
app.use('/api/v1/ctfs', ctfRoutes);
app.use('/api/v1/hackathons', hackathonRoutes);
app.use('/api/v1/leaderboards', leaderboardRoutes);
app.use('/api/v1/admin', adminRoutes);

// Custom API Updates Mount (Requirement 8)
app.post('/api/v1/hint/open', authenticate, openHint);
app.post('/api/v1/challenge/finish', authenticate, requireRole(['admin']), manuallyFinishChallenge);
app.post('/api/v1/hackathon/finish', authenticate, requireRole(['admin']), manuallyFinishHackathon);
app.get('/api/v1/leaderboard', (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticate(req, res, next);
  }
  next();
}, getLeaderboardAndFinishTime);

// Fallback path handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      id: 'SYSTEM_001',
      message: `Resource not found on endpoint: ${req.baseUrl}`
    }
  });
});

// Centralized error interceptor middleware
app.use(errorHandler);

// 4. Initialize Real-time WebSockets
initSocket(server);

// 5. Initialize Schedulers
initCronJobs();

// 6. Start listening
if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    logger.info(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });
}

export default server; // Exporting server instance for unit testing
