import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Thrown when the GitHub Search API rate limit is exhausted.
 * Includes optional `retryAfterSeconds` for client guidance.
 */
export class GithubRateLimitedError extends HttpException {
  constructor(public readonly retryAfterSeconds?: number) {
    super(
      {
        error: 'GITHUB_RATE_LIMITED',
        message: 'GitHub API rate limit exceeded. Please try again later.',
        retryAfter: retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Thrown when the GitHub API is unreachable (network errors, 5xx after retries).
 */
export class GithubUnavailableError extends HttpException {
  constructor(
    message = 'GitHub API is currently unavailable. Please try again later.',
  ) {
    super(
      { error: 'GITHUB_UNAVAILABLE', message },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/**
 * Thrown when GitHub rejects the query (422 validation, etc.).
 */
export class GithubBadRequestError extends HttpException {
  constructor(message: string) {
    super({ error: 'GITHUB_BAD_REQUEST', message }, HttpStatus.BAD_REQUEST);
  }
}
