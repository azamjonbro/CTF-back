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

const challengeSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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
    pointsAwarded: { type: Number, required: true, default: 100 },
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
  },
  hintOpened: {
    type: Boolean,
    default: false
  },
  penaltyApplied: {
    type: Boolean,
    default: false
  },
  flagHintsUnlocked: [{
    type: Number
  }],
  finishedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Ensure a user can only have one session per challenge active at a time
challengeSessionSchema.index({ userId: 1, challengeId: 1 }, { unique: true });

// TTL Index: This automatically sets status to expired or deletes old documents after a given period.
// Note: We also run a BullMQ timer worker to update status and notify the user via websocket in real-time.

const ChallengeSession = mongoose.model('ChallengeSession', challengeSessionSchema);
export default ChallengeSession;
