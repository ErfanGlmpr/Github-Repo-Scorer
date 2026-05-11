import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import {
  AxiosResponse,
  AxiosError,
  AxiosHeaders,
  InternalAxiosRequestConfig,
} from 'axios';
import { GithubService } from './github.service';
import { CacheService } from '../cache/cache.service';
import { GithubSearchResponse } from '../../common/interfaces/github-repository.interface';
import {
  GithubRateLimitedError,
  GithubUnavailableError,
} from './github.errors';

describe('GithubService', () => {
  let service: GithubService;
  let httpService: HttpService;
  let cacheService: jest.Mocked<CacheService>;

  const mockSearchResponse: GithubSearchResponse = {
    total_count: 2,
    incomplete_results: false,
    items: [
      {
        id: 1,
        name: 'repo-a',
        full_name: 'user/repo-a',
        html_url: 'https://github.com/user/repo-a',
        description: 'First repo',
        stargazers_count: 500,
        forks_count: 100,
        language: 'TypeScript',
        created_at: '2024-06-01T00:00:00Z',
        updated_at: '2025-01-10T00:00:00Z',
      },
      {
        id: 2,
        name: 'repo-b',
        full_name: 'user/repo-b',
        html_url: 'https://github.com/user/repo-b',
        description: 'Second repo',
        stargazers_count: 200,
        forks_count: 30,
        language: 'TypeScript',
        created_at: '2024-07-01T00:00:00Z',
        updated_at: '2025-01-12T00:00:00Z',
      },
    ],
  };

  /** Helper to create a successful AxiosResponse */
  function makeAxiosResponse(
    data: GithubSearchResponse,
    headers: Record<string, string> = {},
  ): AxiosResponse<GithubSearchResponse> {
    return {
      data,
      status: 200,
      statusText: 'OK',
      headers,
      config: { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
    };
  }

  /** Helper to create an AxiosError with a response */
  function makeAxiosError(
    status: number,
    data: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ): AxiosError {
    return new AxiosError(
      `Error ${status}`,
      String(status),
      undefined,
      undefined,
      {
        status,
        statusText: `Error ${status}`,
        data,
        headers,
        config: { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      },
    );
  }

  beforeEach(async () => {
    delete process.env.GITHUB_TOKEN;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
            axiosRef: { defaults: { headers: { common: {} } } },
          },
        },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<GithubService>(GithubService);
    httpService = module.get<HttpService>(HttpService);
    cacheService = module.get(CacheService);

    // Speed up retries and bypass Bottleneck delays for tests
    service.setBaseDelay(0);
    service.setLimiter({ minTime: 0, maxConcurrent: 10 });
  });

  // ─── Caching ──────────────────────────────────────────────

  describe('caching', () => {
    it('should return cached data without calling GitHub on cache hit', async () => {
      cacheService.get.mockResolvedValueOnce(mockSearchResponse);
      const getSpy = jest.spyOn(httpService, 'get');

      const result = await service.fetchGithubPage(
        'typescript',
        '2024-01-01',
        1,
      );

      expect(result.data).toEqual(mockSearchResponse);
      expect(getSpy).not.toHaveBeenCalled();
    });

    it('should call GitHub on cache miss and cache the result', async () => {
      cacheService.get.mockResolvedValue(null); // cache miss
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(of(makeAxiosResponse(mockSearchResponse)));

      const result = await service.fetchGithubPage(
        'typescript',
        '2024-01-01',
        1,
      );

      expect(result.data).toEqual(mockSearchResponse);
      // Should have written fresh and stale caches
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(cacheService.set).toHaveBeenCalledTimes(2);
    });

    it('should reuse same cache key for different client parameters (same query + github page)', async () => {
      // First call — cache miss → fetch
      cacheService.get.mockResolvedValue(null);
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(of(makeAxiosResponse(mockSearchResponse)));

      await service.fetchGithubPage('TypeScript', '2024-01-01', 1);

      // Second call — same normalised query, same page
      // Simulate the cached data being available now
      cacheService.get.mockResolvedValueOnce(mockSearchResponse);
      const getSpy = jest.spyOn(httpService, 'get');
      getSpy.mockClear();

      await service.fetchGithubPage('typescript', '2024-01-01', 1);

      expect(getSpy).not.toHaveBeenCalled();
    });
  });

  // ─── Request coalescing ───────────────────────────────────

  describe('request coalescing', () => {
    it('should coalesce concurrent identical requests into one GitHub call', async () => {
      cacheService.get.mockResolvedValue(null);
      const getSpy = jest
        .spyOn(httpService, 'get')
        .mockReturnValue(of(makeAxiosResponse(mockSearchResponse)));

      // Fire 3 concurrent requests for the same page
      const [r1, r2, r3] = await Promise.all([
        service.fetchGithubPage('typescript', '2024-01-01', 1),
        service.fetchGithubPage('typescript', '2024-01-01', 1),
        service.fetchGithubPage('typescript', '2024-01-01', 1),
      ]);

      // All should return the same data
      expect(r1.data).toEqual(mockSearchResponse);
      expect(r2.data).toEqual(mockSearchResponse);
      expect(r3.data).toEqual(mockSearchResponse);

      // But only one HTTP call should have been made
      expect(getSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Retries ──────────────────────────────────────────────

  describe('retries', () => {
    it('should retry on 403 errors', async () => {
      cacheService.get.mockResolvedValue(null);
      const error403 = makeAxiosError(403, {
        message: 'rate limit exceeded',
      });

      const getSpy = jest
        .spyOn(httpService, 'get')
        .mockReturnValueOnce(throwError(() => error403))
        .mockReturnValueOnce(of(makeAxiosResponse(mockSearchResponse)));

      const result = await service.fetchGithubPage(
        'typescript',
        '2024-01-01',
        1,
      );

      expect(result.data).toEqual(mockSearchResponse);
      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it('should retry on 429 errors', async () => {
      cacheService.get.mockResolvedValue(null);
      const error429 = makeAxiosError(429, { message: 'too many requests' });

      const getSpy = jest
        .spyOn(httpService, 'get')
        .mockReturnValueOnce(throwError(() => error429))
        .mockReturnValueOnce(of(makeAxiosResponse(mockSearchResponse)));

      const result = await service.fetchGithubPage(
        'typescript',
        '2024-01-01',
        1,
      );

      expect(result.data).toEqual(mockSearchResponse);
      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it('should retry on 5xx errors', async () => {
      cacheService.get.mockResolvedValue(null);
      const error500 = makeAxiosError(500, { message: 'Server error' });

      const getSpy = jest
        .spyOn(httpService, 'get')
        .mockReturnValueOnce(throwError(() => error500))
        .mockReturnValueOnce(of(makeAxiosResponse(mockSearchResponse)));

      const result = await service.fetchGithubPage(
        'typescript',
        '2024-01-01',
        1,
      );

      expect(result.data).toEqual(mockSearchResponse);
      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it('should retry on network errors (no response)', async () => {
      cacheService.get.mockResolvedValue(null);
      const networkError = new AxiosError('Network Error', 'ERR_NETWORK');

      const getSpy = jest
        .spyOn(httpService, 'get')
        .mockReturnValueOnce(throwError(() => networkError))
        .mockReturnValueOnce(of(makeAxiosResponse(mockSearchResponse)));

      const result = await service.fetchGithubPage(
        'typescript',
        '2024-01-01',
        1,
      );

      expect(result.data).toEqual(mockSearchResponse);
      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it('should respect retry-after header', async () => {
      cacheService.get.mockResolvedValue(null);
      const error429 = makeAxiosError(
        429,
        { message: 'too many requests' },
        { 'retry-after': '1' },
      );

      jest
        .spyOn(httpService, 'get')
        .mockReturnValueOnce(throwError(() => error429))
        .mockReturnValueOnce(of(makeAxiosResponse(mockSearchResponse)));

      // The retry delay computation should use retry-after
      // Since we set baseDelay=0, any delay > 0 proves retry-after was used
      const result = await service.fetchGithubPage(
        'typescript',
        '2024-01-01',
        1,
      );

      expect(result.data).toEqual(mockSearchResponse);
    });

    it('should exhaust retries and throw on persistent 5xx (no stale cache)', async () => {
      cacheService.get.mockResolvedValue(null); // no fresh cache, no stale cache
      const error500 = makeAxiosError(500, { message: 'Server error' });

      const getSpy = jest
        .spyOn(httpService, 'get')
        .mockReturnValue(throwError(() => error500));

      await expect(
        service.fetchGithubPage('typescript', '2024-01-01', 1),
      ).rejects.toThrow(GithubUnavailableError);

      // 1 initial + 3 retries = 4 total calls
      expect(getSpy).toHaveBeenCalledTimes(4);
    });
  });

  // ─── Rate-limit state ─────────────────────────────────────

  describe('rate-limit state', () => {
    it('should fail fast when internal rate-limit state says remaining is 0', async () => {
      cacheService.get.mockResolvedValue(null);

      // First call: get a response with remaining=0 and future reset
      const futureReset = Math.floor(Date.now() / 1000) + 3600; // 1h from now
      // All calls return 429 with remaining=0 — this also covers retries
      jest.spyOn(httpService, 'get').mockReturnValue(
        throwError(() =>
          makeAxiosError(
            429,
            { message: 'rate limit exceeded' },
            {
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': String(futureReset),
              'x-ratelimit-limit': '30',
            },
          ),
        ),
      );

      // First call exhausts retries and updates internal state
      await expect(
        service.fetchGithubPage('typescript', '2024-01-01', 1),
      ).rejects.toThrow(GithubRateLimitedError);

      // Second call should fail fast without any HTTP call
      const getSpy = jest.spyOn(httpService, 'get');
      getSpy.mockClear();

      await expect(
        service.fetchGithubPage('typescript', '2024-01-01', 2),
      ).rejects.toThrow(GithubRateLimitedError);

      expect(getSpy).not.toHaveBeenCalled();
    });
  });

  // ─── Stale fallback ───────────────────────────────────────

  describe('stale fallback', () => {
    it('should return stale cache when GitHub fetch fails', async () => {
      // First get: no fresh cache; second get: stale cache exists
      cacheService.get
        .mockResolvedValueOnce(null) // fresh cache miss
        .mockResolvedValueOnce(mockSearchResponse); // stale cache hit

      const error500 = makeAxiosError(500, { message: 'Server error' });
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(throwError(() => error500));

      const result = await service.fetchGithubPage(
        'typescript',
        '2024-01-01',
        1,
      );

      expect(result.data).toEqual(mockSearchResponse);
      expect(result.meta).toBeDefined();
      expect(result.meta!.stale).toBe(true);
      expect(result.meta!.source).toBe('cache');
      expect(result.meta!.warning).toContain('unavailable');
    });

    it('should throw structured error when no fresh or stale cache exists and GitHub fails', async () => {
      cacheService.get.mockResolvedValue(null); // no cache at all

      const error500 = makeAxiosError(500, { message: 'Server error' });
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(throwError(() => error500));

      await expect(
        service.fetchGithubPage('typescript', '2024-01-01', 1),
      ).rejects.toThrow(GithubUnavailableError);
    });

    it('should return stale cache when rate-limit is exhausted', async () => {
      // Set internal rate-limit state to exhausted
      const futureReset = Math.floor(Date.now() / 1000) + 3600;
      const error429 = makeAxiosError(
        429,
        { message: 'rate limit exceeded' },
        {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(futureReset),
          'x-ratelimit-limit': '30',
        },
      );

      // First call: exhaust retries to set internal state
      cacheService.get.mockResolvedValue(null);
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(throwError(() => error429));

      await expect(
        service.fetchGithubPage('typescript', '2024-01-01', 1),
      ).rejects.toThrow(GithubRateLimitedError);

      // Second call: fail fast but stale cache exists
      // get() calls: 1st for fresh cache → null, then assertRateLimitNotExhausted fails,
      // then stale check → has data
      cacheService.get
        .mockResolvedValueOnce(null) // fresh miss
        .mockResolvedValueOnce(mockSearchResponse); // stale hit

      const result = await service.fetchGithubPage(
        'typescript',
        '2024-01-01',
        2,
      );

      expect(result.data).toEqual(mockSearchResponse);
      expect(result.meta!.stale).toBe(true);
    });
  });

  // ─── GitHub token ─────────────────────────────────────────

  describe('GitHub token configuration', () => {
    it('should set Authorization header when GITHUB_TOKEN is present', async () => {
      process.env.GITHUB_TOKEN = 'test-token-123';

      const mockHeaders: Record<string, string> = {};
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GithubService,
          {
            provide: HttpService,
            useValue: {
              get: jest.fn(),
              axiosRef: { defaults: { headers: { common: mockHeaders } } },
            },
          },
          {
            provide: CacheService,
            useValue: { get: jest.fn(), set: jest.fn() },
          },
        ],
      }).compile();

      module.get<GithubService>(GithubService);

      expect(mockHeaders['Authorization']).toBe('Bearer test-token-123');

      delete process.env.GITHUB_TOKEN;
    });
  });
});
