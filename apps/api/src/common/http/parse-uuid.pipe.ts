import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';
import { AppError } from './api-exception.filter.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Path id of a file that must be a UUID. Anything else is answered like an unknown file (404),
 * never handed to Postgres (where a malformed uuid would be a 500).
 */
@Injectable()
export class ParseUuidPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value === 'string' && UUID.test(value)) return value;
    throw new AppError('FILE_NOT_FOUND', 'File not found', HttpStatus.NOT_FOUND);
  }
}
