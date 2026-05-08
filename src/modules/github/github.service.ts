import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { GithubSearchResponse } from '../../common/interfaces/github-repository.interface';

/**
 * Service responsible for communicating with the GitHub Search API.
 *
 * Features:
 * - Automatic injection of GITHUB_TOKEN (when set) for higher rate limits
 * - Retry with exponential back-off on transient failures (429, 5xx)
 * - Proper error translation to NestJS HttpExceptions
 */
@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);
  private readonly maxRetries = 3;
  private baseDelay = 1_000; // ms

  /** @internal Exposed for testing only */
  setBaseDelay(ms: number): void {
    this.baseDelay = ms;
  }

  constructor(private readonly httpService: HttpService) {
    // Inject Authorization header if a GitHub token is available
    const token = process.env.GITHUB_TOKEN;
    if (token) {
      this.httpService.axiosRef.defaults.headers.common['Authorization'] =
        `Bearer ${token}`;
      this.logger.log('GitHub token configured — higher rate limits enabled');
    } else {
      this.logger.warn(
        'No GITHUB_TOKEN found — using unauthenticated rate limits (60 req/h)',
      );
    }
  }

  /**
   * Search GitHub repositories by language and creation date.
   */
  async searchRepositories(
    language: string,
    createdAfter: string,
    page: number = 1,
    perPage: number = 20,
  ): Promise<GithubSearchResponse> {
    const query = `language:${language} created:>${createdAfter}`;

    const config: AxiosRequestConfig = {
      timeout: 5_000, // 5s timeout as per hardening requirements
      params: {
        q: query,
        sort: 'stars',
        order: 'desc',
        page,
        per_page: perPage,
      },
    };

    return this.requestWithRetry<GithubSearchResponse>(
      '/search/repositories',
      config,
    );
  }

  /**
   * Execute an HTTP GET with retry logic for transient failures.
   */
  private async requestWithRetry<T>(
    url: string,
    config: AxiosRequestConfig,
    attempt: number = 0,
  ): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<T>(url, config),
      );

      this.logRateLimits(response.headers);
      return response.data;
    } catch (error) {
      if (this.isRetryable(error) && attempt < this.maxRetries) {
        const delay = this.baseDelay * Math.pow(2, attempt);
        this.logger.warn({
          message: 'Retrying GitHub API request',
          url,
          attempt: attempt + 1,
          maxRetries: this.maxRetries,
          delayMs: delay,
        });
        await this.sleep(delay);
        return this.requestWithRetry<T>(url, config, attempt + 1);
      }

      throw this.translateError(error);
    }
  }

  /**
   * Log GitHub rate limit status from headers if available.
   */
  private logRateLimits(headers: any): void {
    const remaining = headers['x-ratelimit-remaining'];
    const reset = headers['x-ratelimit-reset'];

    if (remaining !== undefined) {
      this.logger.debug({
        message: 'GitHub rate limit status',
        remaining: Number(remaining),
        reset: reset ? new Date(Number(reset) * 1000).toISOString() : 'unknown',
      });
    }
  }

  /**
   * Determine whether an Axios error is transient and safe to retry.
   */
  private isRetryable(error: unknown): boolean {
    if (error instanceof AxiosError && error.response) {
      const status = error.response.status;
      return status === 429 || status >= 500;
    }
    // Network errors (no response) are always retryable
    if (error instanceof AxiosError && !error.response) {
      return true;
    }
    return false;
  }

  /**
   * Translate Axios errors into meaningful NestJS HttpExceptions.
   */
  private translateError(error: unknown): HttpException {
    if (error instanceof AxiosError) {
      if (!error.response) {
        this.logger.error({
          message: 'Network error contacting GitHub API',
          error: error.message,
          code: error.code,
        });
        return new HttpException(
          'Unable to reach the GitHub API. Please try again later.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      const status = error.response.status;
      const data = error.response.data as Record<string, unknown>;
      const headers = error.response.headers;

      // Log rate limits even on error (especially for 403)
      this.logRateLimits(headers);

      // 4xx Client Errors
      if (status >= 400 && status < 500) {
        if (status === 403) {
          this.logger.warn({
            message: 'GitHub API rate limit exceeded',
            status,
            remaining: headers['x-ratelimit-remaining'],
          });
          return new HttpException(
            'GitHub API rate limit exceeded. Please try again later or configure a GITHUB_TOKEN.',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        if (status === 422) {
          const rawMessage = data?.message;
          const errorMessage =
            typeof rawMessage === 'string' ? rawMessage : 'Validation failed';
          this.logger.warn({
            message: 'GitHub API rejected query (422)',
            error: errorMessage,
            status,
          });
          return new HttpException(
            `GitHub API rejected the query: ${errorMessage}`,
            HttpStatus.BAD_REQUEST,
          );
        }

        this.logger.warn({
          message: 'GitHub API client error',
          status,
          data,
        });
        return new HttpException(
          `GitHub API request failed with status ${status}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      // 5xx Server Errors
      if (status >= 500) {
        this.logger.error({
          message: 'GitHub API server error',
          status,
          data,
        });
        return new HttpException(
          `GitHub API returned a server error (status ${status})`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      this.logger.error({
        message: 'Unexpected GitHub API response',
        status,
        data,
      });
      return new HttpException(
        `GitHub API returned an error (status ${status})`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    // If it's already an HttpException, just re-throw
    if (error instanceof HttpException) {
      return error;
    }

    this.logger.error({
      message: 'Unexpected error in GithubService',
      error: error instanceof Error ? error.stack : String(error),
    });
    return new HttpException(
      'An unexpected error occurred',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
