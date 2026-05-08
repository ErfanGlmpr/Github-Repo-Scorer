import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Wraps every successful response in a consistent envelope.
 *
 * Shape: { statusCode, data, timestamp }
 */
export interface ResponseEnvelope<T> {
  statusCode: number;
  data: T;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ResponseEnvelope<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ResponseEnvelope<T>> {
    const response = context.switchToHttp().getResponse<Response>();
    const statusCode: number = response.statusCode;

    return next.handle().pipe(
      map((data: T) => ({
        statusCode,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
