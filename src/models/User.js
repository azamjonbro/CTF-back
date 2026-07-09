import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  name: { type: String, default: 'Unknown Device' },
  os: { type: String, default: 'Unknown OS' },
  browser: { type: String, default: 'Unknown Browser' },
  ip: { type: String, required: true },
  lastActive: { type: Date, default: Date.now }
}, { _id: false });

const userStatisticsSchema = new mongoose.Schema({
  totalSolved: { type: Number, default: 0 },
  totalAttempts: { type: Number, default: 0 },
  easySolved: { type: Number, default: 0 },
  mediumSolved: { type: Number, default: 0 },
  hardSolved: { type: Number, default: 0 },
  starsEarned: { type: Number, default: 0 },
  pointsEarned: { type: Number, default: 0 },
  teamsJoined: { type: Number, default: 0 },
  hackathonsJoined: { type: Number, default: 0 },
  hackathonsWon: { type: Number, default: 0 }
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 30,
    index: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    index: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  name: { type: String, default: '' },
  surname: { type: String, default: '' },
  age: { type: Number, default: null },
  country: { type: String, default: '' },
  profilePicture: { type: String, default: '' },
  description: { type: String, default: '' },
  information: { type: String, default: '' },
  stars: { type: Number, default: 0, index: true },
  points: { type: Number, default: 0, index: true },
  totalScore: { type: Number, default: 0, index: true },
  ranking: { type: Number, default: 999999 },
  finishTime: { type: Date },
  solvedFlagsCount: { type: Number, default: 0 },
  solvedQuestionsCount: { type: Number, default: 0 },
  totalSolved: { type: Number, default: 0 },
  roles: {
    type: [String],
    enum: ['admin', 'staff', 'support', 'team_leader', 'team_member'],
    default: ['team_member']
  },
  registrationDate: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now },
  completedCtfs: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CTF'
  }],
  devices: [deviceSchema],
  statistics: {
    type: userStatisticsSchema,
    default: () => ({})
  }
}, {
  timestamps: true
});

// Compound index for high performance scoreboard ordering
userSchema.index({ points: -1, stars: -1 });

const syncTotalScoreHook = function (next) {
  const update = this.getUpdate();
  if (update) {
    if (update.$inc && update.$inc.points !== undefined) {
      update.$inc.totalScore = update.$inc.points;
    }
    if (update.$set && update.$set.points !== undefined) {
      update.$set.totalScore = update.$set.points;
    }
  }
  next();
};

userSchema.pre('save', function (next) {
  if (this.isModified('points')) {
    this.totalScore = this.points;
  }
  next();
});

userSchema.pre(['update', 'updateOne', 'updateMany', 'findOneAndUpdate'], syncTotalScoreHook);

// Password hashing before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password methods
userSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

const User = mongoose.model('User', userSchema);
export default User;
