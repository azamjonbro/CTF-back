import Hackathon from '../models/Hackathon.js';
import News from '../models/News.js';
import Team from '../models/Team.js';
import ChallengeSession from '../models/ChallengeSession.js';
import CTF from '../models/CTF.js';
import { AppError, ErrorCatalog } from '../utils/errors.js';
import { LeaderboardService } from '../services/leaderboardService.js';

export const getHackathons = async (req, res, next) => {
  try {
    const hackathons = await Hackathon.find({})
      .select('name description banner coverImage registrationStart registrationEnd hackathonStart hackathonEnd maxTeams status challenges')
      .sort({ hackathonStart: 1 });

    const now = new Date();

    // Map status dynamic countdown details
    const formatted = hackathons.map(h => {
      let countdownSeconds = 0;
      let phase = 'unknown';

      if (now < h.registrationStart) {
        countdownSeconds = Math.max(0, Math.floor((h.registrationStart.getTime() - now.getTime()) / 1000));
        phase = 'registration_starts';
      } else if (now < h.registrationEnd) {
        countdownSeconds = Math.max(0, Math.floor((h.registrationEnd.getTime() - now.getTime()) / 1000));
        phase = 'registration_ends';
      } else if (now < h.hackathonStart) {
        countdownSeconds = Math.max(0, Math.floor((h.hackathonStart.getTime() - now.getTime()) / 1000));
        phase = 'hackathon_starts';
      } else if (now < h.hackathonEnd) {
        countdownSeconds = Math.max(0, Math.floor((h.hackathonEnd.getTime() - now.getTime()) / 1000));
        phase = 'hackathon_ends';
      } else {
        phase = 'completed';
      }

      return {
        ...h.toObject(),
        countdownSeconds,
        phase
      };
    });

    res.status(200).json({
      success: true,
      data: formatted
    });
  } catch (error) {
    next(error);
  }
};

export const getHackathonDetails = async (req, res, next) => {
  try {
    const hackathon = await Hackathon.findById(req.params.hackathonId);
    if (!hackathon) {
      throw new AppError(ErrorCatalog.HACKATHON_NOT_FOUND);
    }

    res.status(200).json({
      success: true,
      data: hackathon
    });
  } catch (error) {
    next(error);
  }
};

// Retrieve Hackathon challenge links - requires registration & active status
export const getHackathonChallenges = async (req, res, next) => {
  try {
    const { hackathonId } = req.params;
    const userId = req.user.userId;

    const hackathon = await Hackathon.findById(hackathonId);
    if (!hackathon) {
      throw new AppError(ErrorCatalog.HACKATHON_NOT_FOUND);
    }

    if (hackathon.status !== 'active') {
      throw new AppError(ErrorCatalog.HACKATHON_NOT_ACTIVE);
    }

    // Verify user team is registered
    const team = await Team.findOne({ members: userId });
    if (!team || !team.hackathonsJoined.includes(hackathonId)) {
      throw new AppError(ErrorCatalog.HACKATHON_TEAM_NOT_REGISTERED);
    }

    const challenges = await CTF.find({
      _id: { $in: hackathon.challenges },
      status: 'active'
    }).select('title shortDescription difficulty stars category');

    // Retrieve completion statuses for the team
    const sessions = await ChallengeSession.find({
      teamId: team._id,
      challengeId: { $in: hackathon.challenges }
    });

    const enriched = challenges.map(c => {
      const session = sessions.find(s => s.challengeId.toString() === c._id.toString());
      return {
        ...c.toObject(),
        sessionStatus: session ? session.status : 'not_started',
        expiresAt: session ? session.expiresAt : null
      };
    });

    res.status(200).json({
      success: true,
      data: enriched
    });
  } catch (error) {
    next(error);
  }
};

// Get hackathon-specific real-time leaderboard
export const getHackathonStandings = async (req, res, next) => {
  try {
    const { hackathonId } = req.params;
    const userId = req.user?.userId;

    let teamId = null;
    if (userId) {
      const team = await Team.findOne({ members: userId });
      if (team) teamId = team._id;
    }

    const standings = await LeaderboardService.getHackathonLeaderboard(hackathonId, teamId);
    if (!standings) {
      throw new AppError(ErrorCatalog.HACKATHON_NOT_FOUND);
    }

    res.status(200).json({
      success: true,
      data: standings
    });
  } catch (error) {
    next(error);
  }
};

// Get news announcements page
export const getNews = async (req, res, next) => {
  try {
    const news = await News.find({})
      .populate('hackathonId', 'name coverImage')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: news
    });
  } catch (error) {
    next(error);
  }
};

// Get all registered teams for a hackathon
export const getHackathonRegisteredTeams = async (req, res, next) => {
  try {
    const { hackathonId } = req.params;
    const hackathon = await Hackathon.findById(hackathonId);
    if (!hackathon) {
      throw new AppError(ErrorCatalog.HACKATHON_NOT_FOUND);
    }

    const teams = await Team.find({ hackathonsJoined: hackathonId })
      .populate('leaderId', 'username email profilePicture')
      .populate('members', 'username email profilePicture')
      .select('name leaderId members points stars ranking createdAt');

    res.status(200).json({
      success: true,
      data: teams
    });
  } catch (error) {
    next(error);
  }
};

