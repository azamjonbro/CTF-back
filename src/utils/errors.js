export const ErrorCatalog = {
  // Authentication Errors
  AUTH_INVALID_CREDENTIALS: { id: 'AUTH_001', status: 401, message: 'Invalid username/email or password' },
  AUTH_UNAUTHORIZED: { id: 'AUTH_002', status: 401, message: 'Unauthorized access. Authentication required' },
  AUTH_TOKEN_EXPIRED: { id: 'AUTH_003', status: 401, message: 'Access token has expired' },
  AUTH_TOKEN_INVALID: { id: 'AUTH_004', status: 401, message: 'Invalid token structure' },
  AUTH_REFRESH_EXPIRED: { id: 'AUTH_005', status: 403, message: 'Refresh token has expired or is invalid' },
  AUTH_FORBIDDEN: { id: 'AUTH_006', status: 403, message: 'You do not have the required permissions/role' },
  AUTH_SESSION_REVOKED: { id: 'AUTH_007', status: 401, message: 'Session has been revoked or logged out' },

  // User Errors
  USER_NOT_FOUND: { id: 'USER_001', status: 404, message: 'User not found' },
  USER_ALREADY_EXISTS: { id: 'USER_002', status: 409, message: 'Username or email already exists' },
  USER_UPDATE_FAILED: { id: 'USER_003', status: 400, message: 'Failed to update user profile' },

  // Team Errors
  TEAM_NOT_FOUND: { id: 'TEAM_001', status: 404, message: 'Team not found' },
  TEAM_ALREADY_EXISTS: { id: 'TEAM_002', status: 409, message: 'Team name already exists' },
  TEAM_MEMBER_ALREADY_IN_TEAM: { id: 'TEAM_003', status: 400, message: 'User is already a member of a team' },
  TEAM_INSUFFICIENT_MEMBERS: { id: 'TEAM_004', status: 400, message: 'Team must have at least 3 members to register for this hackathon' },
  TEAM_NOT_LEADER: { id: 'TEAM_005', status: 403, message: 'Only the Team Leader can perform this action' },
  TEAM_INVITE_INVALID: { id: 'TEAM_006', status: 400, message: 'Invalid team invite code' },

  // CTF Errors
  CTF_NOT_FOUND: { id: 'CTF_001', status: 404, message: 'Challenge not found' },
  CTF_ALREADY_SOLVED: { id: 'CTF_002', status: 400, message: 'This challenge question has already been solved by your team' },
  CTF_FLAG_INCORRECT: { id: 'CTF_003', status: 400, message: 'Incorrect flag submitted' },
  CTF_SESSION_EXPIRED: { id: 'CTF_004', status: 403, message: 'Challenge timer has expired' },
  CTF_SESSION_NOT_FOUND: { id: 'CTF_005', status: 400, message: 'No active session exists for this challenge' },
  CTF_HINT_ALREADY_REVEALED: { id: 'CTF_006', status: 400, message: 'Hint has already been revealed' },

  // Hackathon Errors
  HACKATHON_NOT_FOUND: { id: 'HACKATHON_001', status: 404, message: 'Hackathon not found' },
  HACKATHON_REGISTRATION_CLOSED: { id: 'HACKATHON_002', status: 400, message: 'Hackathon registration period has ended' },
  HACKATHON_NOT_ACTIVE: { id: 'HACKATHON_003', status: 403, message: 'Hackathon is not currently active' },
  HACKATHON_MAX_TEAMS_REACHED: { id: 'HACKATHON_004', status: 400, message: 'Hackathon has reached maximum team capacity' },
  HACKATHON_TEAM_NOT_REGISTERED: { id: 'HACKATHON_005', status: 403, message: 'Your team is not registered for this hackathon' },

  // System Errors
  SYSTEM_BAD_REQUEST: { id: 'SYSTEM_001', status: 400, message: 'Bad request: Invalid payload format or validation failure' },
  SYSTEM_RATE_LIMIT: { id: 'SYSTEM_002', status: 429, message: 'Too many requests. Please try again later' },
  SYSTEM_INTERNAL_ERROR: { id: 'SYSTEM_003', status: 500, message: 'An internal server error occurred' },
  SYSTEM_FILE_UPLOAD_FAILED: { id: 'SYSTEM_004', status: 400, message: 'File upload failed or invalid file format' }
};

export class AppError extends Error {
  constructor(errorSpec, customMessage = null) {
    super(customMessage || errorSpec.message);
    this.id = errorSpec.id;
    this.status = errorSpec.status;
    this.success = false;
    Error.captureStackTrace(this, this.constructor);
  }
}
