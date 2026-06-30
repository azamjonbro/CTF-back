import Team from '../models/Team.js';
import User from '../models/User.js';
import Hackathon from '../models/Hackathon.js';
import AuditLog from '../models/AuditLog.js';
import { AppError, ErrorCatalog } from '../utils/errors.js';
import { LeaderboardService } from '../services/leaderboardService.js';

export const createTeam = async (req, res, next) => {
  try {
    const { name } = req.body;
    const userId = req.user.userId;

    // Check if user is already in a team
    const inTeam = await Team.findOne({ members: userId });
    if (inTeam) {
      throw new AppError(ErrorCatalog.TEAM_MEMBER_ALREADY_IN_TEAM);
    }

    // Check if team name exists
    const teamExists = await Team.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
    if (teamExists) {
      throw new AppError(ErrorCatalog.TEAM_ALREADY_EXISTS);
    }

    const team = new Team({
      name,
      leaderId: userId,
      members: [userId]
    });

    await team.save();

    // Recalculate rankings so the new team gets an actual rank instead of 999999 immediately
    await LeaderboardService.recalculateTeamRankings();

    // Assign team_leader role to user
    await User.findByIdAndUpdate(userId, {
      $addToSet: { roles: 'team_leader' }
    });

    await AuditLog.create({
      userId,
      teamId: team._id,
      action: 'TEAM_CREATE',
      status: 'success',
      details: { name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(201).json({
      success: true,
      message: `Team '${name}' created successfully.`,
      data: team
    });
  } catch (error) {
    next(error);
  }
};

export const joinTeam = async (req, res, next) => {
  try {
    const { inviteCode } = req.body;
    const userId = req.user.userId;

    const inTeam = await Team.findOne({ members: userId });
    if (inTeam) {
      throw new AppError(ErrorCatalog.TEAM_MEMBER_ALREADY_IN_TEAM);
    }

    const team = await Team.findOne({ inviteCode: inviteCode.toUpperCase() });
    if (!team) {
      throw new AppError(ErrorCatalog.TEAM_INVITE_INVALID);
    }

    team.members.push(userId);
    await team.save();

    // Verify user role matches
    await User.findByIdAndUpdate(userId, {
      $addToSet: { roles: 'team_member' }
    });

    await AuditLog.create({
      userId,
      teamId: team._id,
      action: 'TEAM_JOIN',
      status: 'success',
      details: { teamName: team.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: `Successfully joined team '${team.name}'.`,
      data: team
    });
  } catch (error) {
    next(error);
  }
};

export const getMyTeam = async (req, res, next) => {
  try {
    const team = await Team.findOne({ members: req.user.userId })
      .populate('members', 'username email points stars profilePicture country')
      .populate('leaderId', 'username email');
    
    if (!team) {
      throw new AppError(ErrorCatalog.TEAM_NOT_FOUND);
    }

    res.status(200).json({
      success: true,
      data: team
    });
  } catch (error) {
    next(error);
  }
};

export const registerForHackathon = async (req, res, next) => {
  try {
    const { hackathonId } = req.params;
    const userId = req.user.userId;

    const team = await Team.findOne({ members: userId });
    if (!team) {
      throw new AppError(ErrorCatalog.TEAM_NOT_FOUND);
    }

    // Verify role is Team Leader
    if (team.leaderId.toString() !== userId) {
      throw new AppError(ErrorCatalog.TEAM_NOT_LEADER);
    }

    // Validate minimum members (at least 3)
    if (team.members.length < 3) {
      throw new AppError(ErrorCatalog.TEAM_INSUFFICIENT_MEMBERS);
    }

    const hackathon = await Hackathon.findById(hackathonId);
    if (!hackathon) {
      throw new AppError(ErrorCatalog.HACKATHON_NOT_FOUND);
    }

    if (hackathon.status !== 'open') {
      throw new AppError(ErrorCatalog.HACKATHON_REGISTRATION_CLOSED, 'Ro\'yxatdan o\'tish faqat xakaton ochiq (open) holatida bo\'lgandagina mumkin.');
    }

    // Check capacity limit
    const registeredTeamsCount = await Team.countDocuments({ hackathonsJoined: hackathonId });
    if (registeredTeamsCount >= hackathon.maxTeams) {
      throw new AppError(ErrorCatalog.HACKATHON_MAX_TEAMS_REACHED);
    }

    // Register
    if (team.hackathonsJoined.includes(hackathonId)) {
      return res.status(200).json({
        success: true,
        message: 'Your team is already registered for this hackathon.'
      });
    }

    team.hackathonsJoined.push(hackathonId);
    await team.save();

    await AuditLog.create({
      userId,
      teamId: team._id,
      action: 'HACKATHON_REGISTER',
      status: 'success',
      details: { hackathonName: hackathon.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(200).json({
      success: true,
      message: `Team successfully registered for ${hackathon.name}.`
    });
  } catch (error) {
    next(error);
  }
};

export const leaveTeam = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const team = await Team.findOne({ members: userId });
    if (!team) {
      throw new AppError(ErrorCatalog.TEAM_NOT_FOUND, 'Siz hech qanday jamoaga a\'zo emassiz.');
    }

    // Check if the team is currently in an active or finished hackathon
    if (team.hackathonsJoined && team.hackathonsJoined.length > 0) {
      const activeHackathons = await Hackathon.find({
        _id: { $in: team.hackathonsJoined },
        status: { $in: ['running', 'finished'] }
      });
      if (activeHackathons.length > 0) {
        throw new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST, 'Xakaton boshlangan yoki yakunlangan vaqtda jamoani tark etish taqiqlanadi.');
      }
    }

    const isLeader = team.leaderId.toString() === userId;

    if (team.members.length === 1) {
      // Last member leaving - disband/delete team completely
      await Team.findByIdAndDelete(team._id);

      await User.findByIdAndUpdate(userId, {
        $pull: { roles: { $in: ['team_member', 'team_leader'] } }
      });

      await AuditLog.create({
        userId,
        teamId: team._id,
        action: 'TEAM_LEAVE_DISBAND',
        status: 'success',
        details: { teamName: team.name },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
    } else {
      // Remove member
      team.members = team.members.filter(m => m.toString() !== userId);

      if (isLeader) {
        // Appoint new leader
        const newLeaderId = team.members[0];
        team.leaderId = newLeaderId;

        // Grant team_leader role to new leader
        await User.findByIdAndUpdate(newLeaderId, {
          $addToSet: { roles: 'team_leader' }
        });
      }

      await team.save();

      // Remove team roles from current user
      await User.findByIdAndUpdate(userId, {
        $pull: { roles: { $in: ['team_member', 'team_leader'] } }
      });

      await AuditLog.create({
        userId,
        teamId: team._id,
        action: 'TEAM_LEAVE',
        status: 'success',
        details: { teamName: team.name, wasLeader: isLeader },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
    }

    // Recalculate rankings
    await LeaderboardService.recalculateUserRankings();
    await LeaderboardService.recalculateTeamRankings();

    res.status(200).json({
      success: true,
      message: 'Jamoani muvaffaqiyatli tark etdingiz.'
    });
  } catch (error) {
    next(error);
  }
};
