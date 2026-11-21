import { Request, Response } from 'express';
import { sendData } from '../lib/response.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { buildOfferwallLink } from '../services/offerwall.service.js';

export const getOfferwallLink = asyncHandler(
  async (req: Request, res: Response) => {
    sendData(res, { url: buildOfferwallLink(req.user!.publicId) });
  }
);
