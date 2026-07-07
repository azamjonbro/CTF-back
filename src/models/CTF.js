import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  answer: { type: String, required: true }, // bcrypt hashed
  points: { type: Number, required: true, default: 10, min: 10 },
  hint: { type: String, default: '' }
});

const flagSchema = new mongoose.Schema({
  flag: { type: String, required: true },
  points: { type: Number, required: true, default: 100, min: 0 }
});

const ctfSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  shortDescription: { type: String, required: true, maxlength: 250 },
  longDescription: { type: String, required: true },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    required: true
  },
  stars: {
    type: Number,
    required: true
  },
  points: {
    type: Number,
    required: true,
    default: 100
  },
  category: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'disabled'],
    default: 'draft',
    index: true
  },
  timerMinutes: {
    type: Number,
    required: true,
    default: 60
  },
  image: {
    type: String,
    default: ''
  },
  attachments: [{
    type: String
  }],
  hint: {
    type: String,
    default: ''
  },
  flags: {
    type: [flagSchema],
    required: true,
    validate: {
      validator: function (val) {
        return val && val.length >= 1 && val.length <= 3;
      },
      message: 'A CTF challenge must contain between 1 and 3 flags.'
    }
  },
  questions: {
    type: [questionSchema],
    required: true,
    validate: {
      validator: function (val) {
        return val && val.length >= 5 && val.length <= 10;
      },
      message: 'A CTF challenge must contain between 5 and 10 questions.'
    }
  }
}, {
  timestamps: true
});

// Compound indexes for challenges listings
ctfSchema.index({ difficulty: 1, stars: 1 });
ctfSchema.index({ status: 1, category: 1 });

// Text index on titles and descriptions for search
ctfSchema.index({ title: 'text', shortDescription: 'text' });

const CTF = mongoose.model('CTF', ctfSchema);
export default CTF;
