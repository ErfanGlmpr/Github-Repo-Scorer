import { Injectable, Logger, HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError, AxiosRequestConfig } from 'axios';
import Bottleneck from 'bottleneck';
import { CacheService } from '../cache/cache.service';
import { GithubSearchResponse } from '../../common/interfaces/github-repository.interface';
import {
  GithubRateLimitedError,
  GithubUnavailableError,
  GithubBadRequestError,
} from './github.errors';

/** Shape returned by fetchGithubPage — data + optional staleness metadata */
export interface GithubPageResult {
  data: GithubSearchResponse;
  meta?: { source: string; stale: boolean; warning: string };
}

/** Internal rate-limit state captured from response headers */
interface RateLimitState {
  limit: number;
  remaining: number;
  resetAt: Date | null;
}

/**
 * Service responsible for communicating with the GitHub Search API.
 *
 * Features:
 * - Automatic injection of GITHUB_TOKEN (when set) for higher rate limits
 * - Global Bottleneck rate limiter (~25 req/min, max 3 concurrent)
 * - In-process request coalescing to prevent cache stampedes
 * - Redis-backed page caching with stale fallback
 * - Retry with exponential back-off, jitter, and retry-after header support
 * - Internal rate-limit state tracking with fail-fast behaviour
 * - Structured error translation
 */
@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  // ─── Rate limiter ──────────────────────────────────────────
  private limiter = new Bottleneck({
    minTime: 2_400, // ~25 req/min (safety margin below GitHub's 30)
    maxConcurrent: 3,
  });

  // ─── Retry config ──────────────────────────────────────────
  private readonly maxRetries = 3;
  private baseDelay = 1_000; // ms

  // ─── Cache TTLs ────────────────────────────────────────────
  private readonly freshTtl = 600; // 10 minutes
  private readonly staleTtl = 3_600; // 1 hour

  // ─── In-flight coalescing map ──────────────────────────────
  private readonly inFlight = new Map<string, Promise<GithubSearchResponse>>();

  // ─── Internal rate-limit state ─────────────────────────────
  private githubSearchRateLimit: RateLimitState = {
    limit: Infinity,
    remaining: Infinity,
    resetAt: null,
  };

  /** @internal Exposed for testing only */
  setBaseDelay(ms: number): void {
    this.baseDelay = ms;
  }

  /** @internal Exposed for testing only — bypass Bottleneck delays */
  setLimiter(options: { minTime?: number; maxConcurrent?: number }): void {
    this.limiter = new Bottleneck(options);
  }

  constructor(
    private readonly httpService: HttpService,
    private readonly cacheService: CacheService,
  ) {
    // Inject Authorization header if a GitHub token is available
    const token = process.env.GITHUB_TOKEN;
    if (token) {
      this.httpService.axiosRef.defaults.headers.common['Authorization'] =
        `Bearer ${token}`;
      this.logger.log('GitHub token configured — higher rate limits enabled', {
        authenticated: true,
      });
    } else {
      this.logger.warn(
        'No GITHUB_TOKEN found — using unauthenticated rate limits (60 req/h)',
        { authenticated: false },
      );
    }
  }

  // ─── Public API ────────────────────────────────────────────

  /**
   * Fetch a single GitHub Search page (always per_page=100).
   *
   * Flow: fresh cache → in-flight coalescing → rate-limit check →
   *       Bottleneck-throttled HTTP call with retries →
   *       write fresh + stale caches → return.
   *
   * On failure, falls back to stale cache when available.
   */
  async fetchGithubPage(
    language: string,
    createdAfter: string,
    githubPage: number,
  ): Promise<GithubPageResult> {
    const cacheKey = this.buildCacheKey(language, createdAfter, githubPage);
    const staleCacheKey = `${cacheKey}:stale`;

    // 1. Check fresh cache
    const cached = await this.cacheService.get<GithubSearchResponse>(cacheKey);
    if (cached) {
      this.logger.log('Cache HIT (fresh)', { cacheKey, githubPage });
      return { data: cached };
    }
    this.logger.log('Cache MISS', { cacheKey, githubPage });

    // 2. Coalesce concurrent identical requests
    const existing = this.inFlight.get(cacheKey);
    if (existing) {
      this.logger.log('Request coalesced — awaiting in-flight fetch', {
        cacheKey,
      });
      const data = await existing;
      return { data };
    }

    // 3. Check rate-limit state — fail fast if exhausted
    try {
      this.assertRateLimitNotExhausted();
    } catch (err) {
      // Try stale cache before propagating
      const stale =
        await this.cacheService.get<GithubSearchResponse>(staleCacheKey);
      if (stale) {
        this.logger.warn('Rate limit exhausted — returning stale cache', {
          cacheKey,
        });
        return {
          data: stale,
          meta: {
            source: 'cache',
            stale: true,
            warning:
              'GitHub API is currently rate-limited; returned cached results.',
          },
        };
      }
      throw err;
    }

    // 4. Create the fetch promise (coalesced + throttled)
    const query = this.buildQuery(language, createdAfter);
    const promise = this.limiter
      .schedule(() => this.executeWithRetry(query, githubPage))
      .then(async (result) => {
        // Write both fresh and stale caches
        await Promise.all([
          this.cacheService.set(cacheKey, result, this.freshTtl),
          this.cacheService.set(staleCacheKey, result, this.staleTtl),
        ]);
        return result;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });

    this.inFlight.set(cacheKey, promise);

    try {
      const data = await promise;
      return { data };
    } catch (err) {
      // 5. Stale fallback on any failure
      const stale =
        await this.cacheService.get<GithubSearchResponse>(staleCacheKey);
      if (stale) {
        this.logger.warn('GitHub fetch failed — returning stale cache', {
          cacheKey,
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          data: stale,
          meta: {
            source: 'cache',
            stale: true,
            warning:
              'GitHub API is currently unavailable or rate-limited; returned cached results.',
          },
        };
      }
      throw err;
    }
  }

  // ─── Cache key ─────────────────────────────────────────────

  private buildCacheKey(
    language: string,
    createdAfter: string,
    githubPage: number,
  ): string {
    const normalizedLang = language.trim().toLowerCase();
    const normalizedDate = new Date(createdAfter).toISOString().split('T')[0];
    return `github:repos:v1:lang=${normalizedLang}:created=>${normalizedDate}:sort=stars:order=desc:ghPage=${githubPage}:perPage=100`;
  }

  // ─── Query builder ─────────────────────────────────────────

  private buildQuery(language: string, createdAfter: string): string {
    const normalizedLang = language.trim().toLowerCase();
    const normalizedDate = new Date(createdAfter).toISOString().split('T')[0];
    return `language:${normalizedLang} created:>${normalizedDate}`;
  }

  // ─── Rate-limit state ──────────────────────────────────────

  /**
   * Fail fast if we know the rate limit is exhausted.
   */
  private assertRateLimitNotExhausted(): void {
    const { remaining, resetAt } = this.githubSearchRateLimit;
    if (remaining === 0 && resetAt && resetAt.getTime() > Date.now()) {
      const retryAfterSeconds = Math.ceil(
        (resetAt.getTime() - Date.now()) / 1_000,
      );
      this.logger.warn('Rate limit exhausted — failing fast', {
        resetAt: resetAt.toISOString(),
        retryAfterSeconds,
      });
      throw new GithubRateLimitedError(retryAfterSeconds);
    }
  }

  /**
   * Update internal rate-limit state from GitHub response headers.
   */
  private updateRateLimitState(headers: Record<string, unknown>): void {
    const limit = headers['x-ratelimit-limit'];
    const remaining = headers['x-ratelimit-remaining'];
    const reset = headers['x-ratelimit-reset'];
    const resource = headers['x-ratelimit-resource'];

    if (remaining !== undefined && remaining !== null) {
      this.githubSearchRateLimit = {
        limit: limit ? Number(limit) : this.githubSearchRateLimit.limit,
        remaining: Number(remaining),
        resetAt: reset ? new Date(Number(reset) * 1000) : null,
      };

      this.logger.log('GitHub API rate limit status', {
        rateLimit: this.githubSearchRateLimit.limit,
        remainingRequests: this.githubSearchRateLimit.remaining,
        resetAt: this.githubSearchRateLimit.resetAt
          ? this.githubSearchRateLimit.resetAt.toISOString()
          : 'unknown',
        resource: resource ?? 'unknown',
      });
    }
  }

  // ─── HTTP execution with retries ───────────────────────────

  /**
   * Execute a GitHub Search API call with retry logic.
   */
  private async executeWithRetry(
    query: string,
    githubPage: number,
    attempt: number = 0,
  ): Promise<GithubSearchResponse> {
    const config: AxiosRequestConfig = {
      timeout: 10_000,
      params: {
        q: query,
        sort: 'stars',
        order: 'desc',
        page: githubPage,
        per_page: 100,
      },
    };

    this.logger.log('GitHub outbound request', {
      query,
      githubPage,
      attempt: attempt + 1,
    });

    try {
      const response = await firstValueFrom(
        this.httpService.get<GithubSearchResponse>(
          '/search/repositories',
          config,
        ),
      );

      this.updateRateLimitState(response.headers);
      return response.data;
    } catch (error) {
      // Update rate-limit state even on error responses
      if (error instanceof AxiosError && error.response) {
        this.updateRateLimitState(error.response.headers);
      }

      if (this.isRetryable(error) && attempt < this.maxRetries) {
        const delay = this.computeRetryDelay(error, attempt);
        this.logger.warn('Retrying GitHub API request', {
          attempt: attempt + 1,
          maxRetries: this.maxRetries,
          delayMs: delay,
          status:
            error instanceof AxiosError ? error.response?.status : undefined,
        });
        await this.sleep(delay);
        return this.executeWithRetry(query, githubPage, attempt + 1);
      }

      throw this.translateError(error);
    }
  }

  // ─── Retry helpers ─────────────────────────────────────────

  /**
   * Determine whether an error is transient and safe to retry.
   * Retries: 403, 429, 5xx, network errors. Does NOT retry 400/422.
   */
  private isRetryable(error: unknown): boolean {
    if (error instanceof AxiosError && error.response) {
      const status = error.response.status;
      return status === 403 || status === 429 || status >= 500;
    }
    // Network errors (no response) are always retryable
    if (error instanceof AxiosError && !error.response) {
      return true;
    }
    return false;
  }

  /**
   * Compute retry delay:
   * 1. Respect `retry-after` header if present
   * 2. If rate-limit remaining is 0, wait until reset time
   * 3. Otherwise exponential backoff with jitter
   */
  private computeRetryDelay(error: unknown, attempt: number): number {
    // When baseDelay is 0 (test mode), skip all delays
    if (this.baseDelay === 0) return 0;

    if (error instanceof AxiosError && error.response) {
      const headers = error.response.headers as Record<string, string>;

      // 1. retry-after header (seconds)
      const retryAfter = headers['retry-after'];
      if (retryAfter) {
        return parseInt(retryAfter, 10) * 1_000;
      }

      // 2. x-ratelimit-remaining === 0 with reset time
      const remaining = headers['x-ratelimit-remaining'];
      const reset = headers['x-ratelimit-reset'];
      if (remaining === '0' && reset) {
        const resetMs = Number(reset) * 1_000;
        const waitMs = Math.max(resetMs - Date.now(), 1_000);
        return Math.min(waitMs, 60_000); // cap at 60s
      }
    }

    // 3. Exponential backoff with jitter
    const backoff = this.baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * this.baseDelay;
    return backoff + jitter;
  }

  // ─── Error translation ─────────────────────────────────────

  /**
   * Translate errors into structured application errors.
   */
  private translateError(error: unknown): HttpException {
    if (error instanceof AxiosError) {
      if (!error.response) {
        this.logger.error('Network error contacting GitHub API', {
          error: error.message,
          operation: 'githubRequest',
        });
        return new GithubUnavailableError();
      }

      const status = error.response.status;
      const data = error.response.data as Record<string, unknown>;

      if (status === 403 || status === 429) {
        const headers = error.response.headers as Record<string, string>;
        const retryAfter = headers['retry-after']
          ? parseInt(headers['retry-after'], 10)
          : undefined;
        this.logger.warn('GitHub API rate limit exceeded', {
          statusCode: status,
          retryAfter,
        });
        return new GithubRateLimitedError(retryAfter);
      }

      if (status === 422) {
        const msg =
          typeof data?.message === 'string'
            ? data.message
            : 'Validation failed';
        this.logger.error('GitHub API rejected query', {
          error: msg,
          statusCode: status,
          operation: 'githubSearch',
        });
        return new GithubBadRequestError(
          `GitHub API rejected the query: ${msg}`,
        );
      }

      if (status >= 400 && status < 500) {
        this.logger.error('GitHub API client error', {
          statusCode: status,
          error: data?.message || 'Client error',
          operation: 'githubRequest',
        });
        return new GithubBadRequestError(
          `GitHub API request failed with status ${status}`,
        );
      }

      if (status >= 500) {
        this.logger.error('GitHub API server error', {
          statusCode: status,
          error: data?.message || 'Server error',
          operation: 'githubRequest',
        });
        return new GithubUnavailableError(
          `GitHub API returned a server error (status ${status})`,
        );
      }

      return new GithubUnavailableError(
        `GitHub API returned an error (status ${status})`,
      );
    }

    // Re-throw existing HttpExceptions
    if (error instanceof HttpException) {
      return error;
    }

    this.logger.error('Unexpected error in GithubService', {
      error: error instanceof Error ? error.message : String(error),
      operation: 'githubServiceInternal',
    });
    return new GithubUnavailableError('An unexpected error occurred');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
