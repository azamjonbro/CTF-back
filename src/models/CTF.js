import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  type: { type: String, default: 'text' },
  options: { type: [String], default: [] },
  correctAnswer: { type: String },
  answer: { type: String }, // for backward compatibility
  points: { type: Number, required: true, default: 10, min: 0 },
  hint: { type: String, default: '' }
});

const flagSchema = new mongoose.Schema({
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  hint: { type: String, default: '' },
  flag: { type: String, required: true },
  points: { type: Number, required: true, default: 100, min: 0 },
  attachment: { type: String, default: '' }
});

const ctfSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  shortDescription: { type: String, default: '', maxlength: 250 },
  longDescription: { type: String, default: '' },
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
    enum: ['draft', 'active', 'disabled', 'finished'],
    default: 'draft',
    index: true
  },
  endTime: {
    type: Date
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
    default: []
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
