import Hackathon from '../models/Hackathon.js';
import logger from '../utils/logger.js';

export const syncHackathonStatuses = async (req, res, next) => {
  try {
    const now = new Date();

    // 1. Transition 'open'/'closed' to 'running' if current time is past start time
    const startResult = await Hackathon.updateMany(
      { status: { $in: ['open', 'closed'] }, hackathonStart: { $lte: now } },
      { $set: { status: 'running' } }
    );

    if (startResult.modifiedCount > 0) {
      logger.info(`Dynamic Sync: Started ${startResult.modifiedCount} hackathons.`);
    }

    // 2. Transition 'running' to 'finished' if current time is past end time
    const endResult = await Hackathon.updateMany(
      { status: 'running', hackathonEnd: { $lte: now } },
      { $set: { status: 'finished' } }
    );

    if (endResult.modifiedCount > 0) {
      logger.info(`Dynamic Sync: Finished ${endResult.modifiedCount} hackathons.`);
    }
  } catch (error) {
    logger.error(`Error during dynamic hackathon sync: ${error.message}`);
  }
  next();
};
