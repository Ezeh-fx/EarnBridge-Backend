import { HttpStatus } from '../config/httpStatus';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    isOperational = true
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(code: string, message: string): AppError {
    return new AppError(HttpStatus.BAD_REQUEST, code, message);
  }

  static unauthorized(code: string, message: string): AppError {
    return new AppError(HttpStatus.UNAUTHORIZED, code, message);
  }

  static forbidden(code: string, message: string): AppError {
    return new AppError(HttpStatus.FORBIDDEN, code, message);
  }

  static notFound(code: string, message: string): AppError {
    return new AppError(HttpStatus.NOT_FOUND, code, message);
  }

  static conflict(code: string, message: string): AppError {
    return new AppError(HttpStatus.CONFLICT, code, message);
  }

  static unprocessable(code: string, message: string): AppError {
    return new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
  }

  static tooManyRequests(code: string, message: string): AppError {
    return new AppError(HttpStatus.TOO_MANY_REQUESTS, code, message);
  }

  static internal(code: string, message: string): AppError {
    return new AppError(
      HttpStatus.INTERNAL_SERVER_ERROR,
      code,
      message,
      false
    );
  }
}
