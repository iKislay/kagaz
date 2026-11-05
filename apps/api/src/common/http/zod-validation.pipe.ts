import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';
import { type ZodType } from 'zod';
import { AppError } from './api-exception.filter.js';

/**
 * Validates a request body/query/param against a zod schema (usually from @kagaz/shared).
 * Usage: @Body(new ZodValidationPipe(PrintOptionsSchema)) options: PrintOptions
 * Use z.strictObject schemas so unknown fields (e.g. a client-sent "amount") are rejected.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Request validation failed',
        HttpStatus.BAD_REQUEST,
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return result.data;
  }
}
