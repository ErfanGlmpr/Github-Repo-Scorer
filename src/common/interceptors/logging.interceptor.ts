import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

/**
 * Interceptor that logs:
 *  - incoming request method, URL, and query params
 *  - response status and latency in milliseconds
 *
 * Provides observability without requiring external APM tools.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, query } = request;
    const startTime = Date.now();

    this.logger.log(`→ ${method} ${url}`, { params: query });

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.logger.log(`← ${method} ${url}`, { durationMs: duration });
        },
        error: (error: unknown) => {
          const duration = Date.now() - startTime;
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(`← ${method} ${url} ERROR`, {
            durationMs: duration,
            error: message,
          });
        },
      }),
    );
  }
}
