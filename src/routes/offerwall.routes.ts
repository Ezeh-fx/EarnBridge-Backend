import { Router } from 'express';
import { getOfferwallLink } from '../controllers/offerwall.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const offerwallRouter = Router();

offerwallRouter.get('/link', requireAuth, getOfferwallLink);
