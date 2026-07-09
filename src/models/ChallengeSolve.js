import mongoose from 'mongoose';

const challengeSolveSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team'
  },
  challengeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CTF',
    required: true
  },
  solvedAt: {
    type: Date,
    default: Date.now
  },
  pointsAwarded: {
    type: Number,
    required: true,
    min: 0
  }
}, {
  timestamps: true
});

// Ensure a user can only solve a challenge once
challengeSolveSchema.index({ userId: 1, challengeId: 1 }, { unique: true });

// Index for team-level solves in hackathons
challengeSolveSchema.index({ teamId: 1, challengeId: 1 });

const ChallengeSolve = mongoose.model('ChallengeSolve', challengeSolveSchema);
export default ChallengeSolve;
