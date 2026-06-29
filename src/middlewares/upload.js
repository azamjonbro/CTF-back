import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { AppError, ErrorCatalog } from '../utils/errors.js';

// Setup storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// Configure file types whitelist
const ALLOWED_MIME_TYPES = {
  // Images
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  // Videos
  'video/mp4': ['.mp4'],
  'video/quicktime': ['.mov'],
  'video/webm': ['.webm'],
  // Audio
  'audio/mpeg': ['.mp3'],
  'audio/wav': ['.wav'],
  'audio/ogg': ['.ogg'],
  // Text and Script files
  'text/plain': ['.txt'],
  'application/x-javascript': ['.js'],
  'text/javascript': ['.js'],
  'text/x-python': ['.py'],
  'text/x-php': ['.php'],
  'application/x-httpd-php': ['.php']
};

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype;

  // Validate Mime type & Extension match
  const allowedExtensions = ALLOWED_MIME_TYPES[mimeType];
  if (!allowedExtensions || !allowedExtensions.includes(ext)) {
    return cb(new AppError(ErrorCatalog.SYSTEM_FILE_UPLOAD_FAILED, `File type not allowed: extension ${ext} with mime-type ${mimeType}`));
  }

  cb(null, true);
};

// Virus Scan Hook (Placeholder ready for ClamAV / VirusTotal integrations)
export const scanForViruses = async (filePath) => {
  // Enterprise scan implementation would execute a clamscan command:
  // exec(`clamscan ${filePath}`, (err, stdout, stderr) => { ... })
  // For production mock: we assume file is clean unless it contains string "EICAR"
  return true; 
};

export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB maximum
  }
});
