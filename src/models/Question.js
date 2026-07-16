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
}, {
  timestamps: true
});

const Question = mongoose.model('Question', questionSchema);
export default Question;
