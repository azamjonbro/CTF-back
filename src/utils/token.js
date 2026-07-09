import jwt from 'jsonwebtoken';

export const generateAccessToken = (user) => {
  const payload = {
    userId: user._id.toString(),
    username: user.username,
    roles: user.roles,
  };
  const isAdmin = user.roles && user.roles.includes('admin');
  const expiry = isAdmin ? '7d' : (process.env.JWT_ACCESS_EXPIRY || '15m');
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: expiry
  });
};

export const generateRefreshToken = (user, deviceId) => {
  const payload = {
    userId: user._id.toString(),
    deviceId: deviceId
  };
  const isAdmin = user.roles && user.roles.includes('admin');
  const expiry = isAdmin ? '30d' : (process.env.JWT_REFRESH_EXPIRY || '7d');
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: expiry
  });
};

export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (error) {
    return null;
  }
};

export const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch (error) {
    return null;
  }
};
