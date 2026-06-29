import mongoose from 'mongoose';
import crypto from 'crypto';

const teamSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 50,
    index: true
  },
  leaderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  inviteCode: {
    type: String,
    unique: true,
    index: true
  },
  points: {
    type: Number,
    default: 0,
    index: true
  },
  stars: {
    type: Number,
    default: 0,
    index: true
  },
  ranking: {
    type: Number,
    default: 999999
  },
  hackathonsJoined: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hackathon'
  }]
}, {
  timestamps: true
});

// Compound index for real-time team leaderboard rank queries
teamSchema.index({ points: -1, stars: -1 });

// Generate secure team invite code before validation
teamSchema.pre('validate', function (next) {
  if (!this.inviteCode) {
    this.inviteCode = crypto.randomBytes(6).toString('hex').toUpperCase(); // 12-char unique key
  }
  next();
});

const Team = mongoose.model('Team', teamSchema);
export default Team;
