import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type Response } from 'express';
import { type ApiError } from '@kagaz/shared';

/** Thrown by application code to return a stable, documented error code. */
export class AppError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}

const STATUS_CODES: Partial<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

/**
 * Every error leaves the API as { error: { code, message, details? } } (CLAUDE.md conventions).
 * Unexpected errors are logged with the stack and returned as a generic INTERNAL_ERROR.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiError = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } };

    if (exception instanceof AppError) {
      status = exception.getStatus();
      body = {
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details === undefined ? {} : { details: exception.details }),
        },
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'object' && response !== null && 'message' in response
          ? String((response as { message: unknown }).message)
          : exception.message;
      body = { error: { code: STATUS_CODES[status] ?? 'HTTP_ERROR', message } };
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json(body);
  }
}
