import { LifecycleService } from '../services/lifecycleService.js';

export const syncHackathonStatuses = async (req, res, next) => {
  await LifecycleService.syncHackathonLifecycle();
  next();
};
