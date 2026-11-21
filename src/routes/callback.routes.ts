import { Router } from 'express';
import { ayetCallback } from '../controllers/callback.controller.js';

export const callbackRouter = Router();

callbackRouter.get('/ayet', ayetCallback);
