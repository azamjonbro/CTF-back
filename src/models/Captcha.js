import mongoose from 'mongoose';

const captchaSchema = new mongoose.Schema({
  answer: {
    type: Number,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300 // TTL Index: auto-deleted after 5 minutes (300 seconds)
  }
});

const Captcha = mongoose.model('Captcha', captchaSchema);
export default Captcha;
