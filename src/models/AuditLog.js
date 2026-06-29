import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    default: null,
    index: true
  },
  action: {
    type: String,
    required: true,
    index: true // e.g., 'LOGIN', 'LOGOUT', 'SUBMIT_FLAG', 'CREATE_TEAM', 'CREATE_CHALLENGE'
  },
  status: {
    type: String,
    enum: ['success', 'failure', 'warning'],
    required: true,
    index: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  ipAddress: {
    type: String,
    default: '127.0.0.1'
  },
  userAgent: {
    type: String,
    default: 'Unknown'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 90 * 24 * 60 * 60 // Auto-delete logs after 90 days (TTL Index)
  }
}, {
  timestamps: false // We use our own createdAt timestamp
});

auditLogSchema.index({ action: 1, status: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
