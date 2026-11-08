import { Response } from 'express';
import { HttpStatus } from '../config/httpStatus';

export interface ApiResponse<T> {
  data: T;
}

export const sendData = <T>(
  res: Response,
  data: T,
  statusCode: number = HttpStatus.OK
): Response => {
  return res.status(statusCode).json({ data } satisfies ApiResponse<T>);
};
