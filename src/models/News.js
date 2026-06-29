import mongoose from 'mongoose';

const newsSchema = new mongoose.Schema({
  hackathonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hackathon',
    default: null
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['announcement', 'hackathon'],
    default: 'announcement',
    index: true
  }
}, {
  timestamps: true
});

const News = mongoose.model('News', newsSchema);
export default News;
