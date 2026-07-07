import mongoose from 'mongoose';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import Team from '../models/Team.js';
import CTF from '../models/CTF.js';
import ChallengeSession from '../models/ChallengeSession.js';
import TeamChallenge from '../models/TeamChallenge.js';
import Hackathon from '../models/Hackathon.js';
import { LeaderboardService } from '../services/leaderboardService.js';
import { AppError, ErrorCatalog } from '../utils/errors.js';

// Helper to get CTF history for a user
const getCtfHistory = async (userId) => {
  const team = await Team.findOne({ members: userId });

  // 1. Fetch practice sessions (belonging to the user)
  const practiceSessions = await ChallengeSession.find({ userId })
    .populate('challengeId', 'title category difficulty stars questions');

  // 2. Fetch team/hackathon sessions (belonging to the team)
  let hackathonSessions = [];
  if (team) {
    hackathonSessions = await TeamChallenge.find({ teamId: team._id })
      .populate('challengeId', 'title category difficulty stars questions');
  }

  // Combine both practice and team sessions
  const sessions = [...practiceSessions, ...hackathonSessions];

  // Map and format the history
  const history = sessions.map(session => {
    if (!session.challengeId) return null;
    const challenge = session.challengeId;
    
    // Sum points awarded for solved questions and flags
    const qPoints = session.solvedQuestions ? session.solvedQuestions.reduce((sum, sq) => sum + (sq.pointsAwarded || 0), 0) : 0;
    const fPoints = session.solvedFlags ? session.solvedFlags.reduce((sum, sf) => sum + (sf.pointsAwarded || 0), 0) : 0;
    const points = qPoints + fPoints;
    
    // Total questions in challenge
    const totalQuestions = challenge.questions?.length || 0;
    const solvedQuestionsCount = session.solvedQuestions.length;

    return {
      challengeId: challenge._id,
      title: challenge.title,
      category: challenge.category,
      difficulty: challenge.difficulty,
      stars: challenge.stars,
      points,
      solvedQuestionsCount,
      totalQuestions,
      status: session.status,
      completedAt: session.status === 'completed' ? session.updatedAt : null
    };
  }).filter(Boolean);

  return history;
};

// Helper to get Hackathon history/standings for a user
const getHackathonHistory = async (userId) => {
  const team = await Team.findOne({ members: userId });
  if (!team) return [];

  const hackathonHistory = [];

  for (const hackathonId of team.hackathonsJoined) {
    const hackathon = await Hackathon.findById(hackathonId).select('name status hackathonStart hackathonEnd');
    if (!hackathon) continue;

    const standings = await LeaderboardService.getHackathonLeaderboard(hackathon._id, team._id);
    if (!standings) continue;

    // Find our team's entry in the leaderboard
    const teamStanding = standings.leaderboard.find(t => t._id.toString() === team._id.toString());
    
    hackathonHistory.push({
      hackathonId: hackathon._id,
      name: hackathon.name,
      status: hackathon.status,
      hackathonStart: hackathon.hackathonStart,
      hackathonEnd: hackathon.hackathonEnd,
      rank: teamStanding ? teamStanding.rank : null,
      points: teamStanding ? teamStanding.points : 0,
      solved: teamStanding ? teamStanding.solved : 0,
      totalTeams: standings.leaderboard.length
    });
  }

  return hackathonHistory;
};

export const getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId)
      .select('-passwordHash -devices');
    
    if (!user) {
      throw new AppError(ErrorCatalog.USER_NOT_FOUND);
    }

    const ctfHistory = await getCtfHistory(user._id);
    const hackathonHistory = await getHackathonHistory(user._id);

    res.status(200).json({
      success: true,
      data: {
        ...user.toObject(),
        ctfHistory,
        hackathonHistory
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicProfile = async (req, res, next) => {
  try {
    const user = await User.findOne({ username: req.params.username.toLowerCase() })
      .select('username name surname country profilePicture description information stars points ranking statistics registrationDate lastActive');
    
    if (!user) {
      throw new AppError(ErrorCatalog.USER_NOT_FOUND);
    }

    const ctfHistory = await getCtfHistory(user._id);
    const hackathonHistory = await getHackathonHistory(user._id);

    res.status(200).json({
      success: true,
      data: {
        ...user.toObject(),
        ctfHistory,
        hackathonHistory
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const { name, surname, age, country, description, information, profilePicture, username, oldPassword, newPassword, confirmPassword } = req.body;
    
    const user = await User.findById(req.user.userId);
    if (!user) {
      throw new AppError(ErrorCatalog.USER_NOT_FOUND);
    }

    if (username !== undefined && username.trim() !== '') {
      const normalizedUsername = username.trim().toLowerCase();
      if (normalizedUsername !== user.username) {
        if (!/^[a-zA-Z0-9]{3,30}$/.test(normalizedUsername)) {
          throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Username must be alphanumeric and between 3 and 30 characters.');
        }
        const existing = await User.findOne({ username: normalizedUsername });
        if (existing) {
          throw new AppError(ErrorCatalog.USER_ALREADY_EXISTS, 'Username is already taken.');
        }
        user.username = normalizedUsername;
      }
    }

    if (newPassword !== undefined && newPassword !== '') {
      if (!oldPassword) {
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Eski parolni kiritish majburiy.');
      }
      const isMatch = await user.comparePassword(oldPassword);
      if (!isMatch) {
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Eski parol noto\'g\'ri kiritildi.');
      }
      if (newPassword !== confirmPassword) {
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Yangi parol va uni tasdiqlash mos kelmadi.');
      }
      if (newPassword.length < 8) {
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Yangi parol kamida 8 ta belgidan iborat bo\'lishi kerak.');
      }
      user.passwordHash = newPassword;
    }

    if (name !== undefined) user.name = name;
    if (surname !== undefined) user.surname = surname;
    if (age !== undefined) user.age = age;
    if (country !== undefined) user.country = country;
    if (description !== undefined) user.description = description;
    if (information !== undefined) user.information = information;
    if (profilePicture !== undefined) user.profilePicture = profilePicture;

    await user.save();

    // Log update action
    await AuditLog.create({
      userId: user._id,
      action: 'PROFILE_UPDATE',
      status: 'success',
      details: { fieldsChanged: Object.keys(req.body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      data: {
        username: user.username,
        name: user.name,
        surname: user.surname,
        age: user.age,
        country: user.country,
        description: user.description,
        information: user.information,
        profilePicture: user.profilePicture
      }
    });
  } catch (error) {
    next(error);
  }
};

// Generate GitHub-style activity calendar data
export const getActivityCalendar = async (req, res, next) => {
  try {
    let userId;
    const { username } = req.query;
    
    if (username) {
      const user = await User.findOne({ username: username.toLowerCase() });
      if (!user) {
        throw new AppError(ErrorCatalog.USER_NOT_FOUND);
      }
      userId = user._id;
    } else {
      if (!req.user || !req.user.userId) {
        throw new AppError(ErrorCatalog.AUTH_UNAUTHORIZED);
      }
      userId = req.user.userId;
    }
    
    // Group audit logs by date and count actions
    const calendar = await AuditLog.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId)
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 },
          activities: {
            $push: {
              action: '$action',
              status: '$status',
              timestamp: '$createdAt'
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: calendar
    });
  } catch (error) {
    next(error);
  }
};

export const getDashboardStats = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    // 1. Get user details
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(ErrorCatalog.USER_NOT_FOUND);
    }

    // 2. Get user's active team
    const team = await Team.findOne({ members: userId }).select('name');
    const teamName = team ? team.name : 'No Team';

    // 3. Count solved questions per category from AuditLogs
    const solvedLogs = await AuditLog.find({
      userId: userId,
      action: 'SUBMIT_QUESTION_SUCCESS',
      status: 'success'
    }).select('details');

    const challengeIds = [...new Set(solvedLogs.map(log => log.details?.challengeId?.toString()).filter(Boolean))];

    const challenges = await CTF.find({ _id: { $in: challengeIds } }).select('_id category');

    const challengeCategoryMap = {};
    challenges.forEach(c => {
      challengeCategoryMap[c._id.toString()] = c.category;
    });

    const categorySolvedCounts = {
      'Web Exploitation': 0,
      'Reverse Engineering': 0,
      'Cryptography': 0,
      'Forensics': 0,
      'PWN': 0
    };

    solvedLogs.forEach(log => {
      const challengeId = log.details?.challengeId?.toString();
      if (challengeId && challengeCategoryMap[challengeId]) {
        const category = challengeCategoryMap[challengeId];
        if (categorySolvedCounts[category] !== undefined) {
          categorySolvedCounts[category]++;
        } else {
          categorySolvedCounts[category] = 1;
        }
      }
    });

    res.status(200).json({
      success: true,
      data: {
        username: user.username,
        points: user.points || 0,
        stars: user.stars || 0,
        solves: user.statistics?.totalSolved || 0,
        ranking: user.ranking || 999999,
        teamName,
        skillsProfile: categorySolvedCounts
      }
    });
  } catch (error) {
    next(error);
  }
};
