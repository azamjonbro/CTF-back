import mongoose from 'mongoose';

const hackathonSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  description: {
    type: String,
    required: true
  },
  banner: {
    type: String,
    default: ''
  },
  coverImage: {
    type: String,
    default: ''
  },
  hackathonStart: {
    type: Date,
    required: true
  },
  hackathonEnd: {
    type: Date,
    required: true
  },
  maxTeams: {
    type: Number,
    required: true,
    min: 2
  },
  status: {
    type: String,
    enum: ['upcoming', 'active', 'finished'],
    default: 'upcoming',
    index: true
  },
  challenges: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CTF'
  }]
}, {
  timestamps: true
});

const Hackathon = mongoose.model('Hackathon', hackathonSchema);
export default Hackathon;
