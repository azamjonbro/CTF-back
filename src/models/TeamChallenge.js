import mongoose from 'mongoose';

const hintUnlockSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  hintIndex: { type: Number, required: true }
}, { _id: false });

const solvedQuestionSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  solvedAt: { type: Date, default: Date.now },
  pointsAwarded: { type: Number, required: true }
}, { _id: false });

const questionAttemptSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  failedAttempts: { type: Number, default: 0 }
}, { _id: false });

const flagAttemptSchema = new mongoose.Schema({
  flagIndex: { type: Number, required: true },
  failedAttempts: { type: Number, default: 0 }
}, { _id: false });

const teamChallengeSchema = new mongoose.Schema({
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true
  },
  challengeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CTF',
    required: true
  },
  openedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'expired'],
    default: 'active',
    index: true
  },
  hintsUnlocked: [hintUnlockSchema],
  solvedQuestions: [solvedQuestionSchema],
  solvedFlags: [{
    flagIndex: { type: Number, required: true },
    solvedAt: { type: Date, default: Date.now }
  }],
  questionAttempts: [questionAttemptSchema],
  flagAttempts: [flagAttemptSchema],
  failedAttempts: {
    type: Number,
    default: 0
  },
  hintUsed: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Ensure a team can only have one session per challenge active at a time
teamChallengeSchema.index({ teamId: 1, challengeId: 1 }, { unique: true });

const TeamChallenge = mongoose.model('TeamChallenge', teamChallengeSchema);
export default TeamChallenge;
