import logger from '../utils/logger.js';
import { AppError, ErrorCatalog } from '../utils/errors.js';

export const errorHandler = (err, req, res, next) => {
  let errorResponse = {
    success: false,
    error: {
      id: 'SYSTEM_003',
      message: 'An internal server error occurred'
    }
  };
  
  let statusCode = 500;

  if (err instanceof AppError) {
    statusCode = err.status;
    errorResponse.error = {
      id: err.id,
      message: err.message
    };
    if (err.details) {
      errorResponse.error.details = err.details;
    }
  } else if (err.name === 'ValidationError') {
    // MongoDB Mongoose Validation Error
    statusCode = 400;
    errorResponse.error = {
      id: 'SYSTEM_001',
      message: err.message
    };
  } else {
    // Unexpected error - log with full stack trace for debugging
    logger.error(`Unhandled Error: ${err.message}\nStack: ${err.stack}`);
  }

  // Log errors for debugging/auditing purposes
  if (statusCode >= 500) {
    logger.error(`[500 Internal Error] Path: ${req.path} Method: ${req.method} ID: ${errorResponse.error.id} - ${err.message}`);
  } else {
    logger.warn(`[Client Error] Path: ${req.path} Method: ${req.method} Status: ${statusCode} ID: ${errorResponse.error.id} - ${err.message}`);
  }

  return res.status(statusCode).json(errorResponse);
};
