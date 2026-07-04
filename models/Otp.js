const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  institutionId: {
    type: String,
    required: true,
    unique: true
  },
  otp: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300 // The document will be automatically deleted after 300 seconds (5 minutes)
  }
});

module.exports = mongoose.model('Otp', otpSchema);
