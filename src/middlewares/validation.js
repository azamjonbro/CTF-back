import { AppError, ErrorCatalog } from '../utils/errors.js';

export const validateRequest = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map(err => ({
        field: err.path.join('.'),
        message: err.message
      }));
      
      const appErr = new AppError(ErrorCatalog.SYSTEM_BAD_REQUEST);
      appErr.details = details;
      return next(appErr);
    }

    // Replace request payload with sanitized and stripped value
    req[property] = value;
    next();
  };
};
