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

const challengeSessionSchema = new mongoose.Schema({
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
  failedAttempts: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Ensure a team can only have one session per challenge active at a time
challengeSessionSchema.index({ teamId: 1, challengeId: 1 }, { unique: true });

// TTL Index: This automatically sets status to expired or deletes old documents after a given period.
// Note: We also run a BullMQ timer worker to update status and notify the user via websocket in real-time.

const ChallengeSession = mongoose.model('ChallengeSession', challengeSessionSchema);
export default ChallengeSession;
