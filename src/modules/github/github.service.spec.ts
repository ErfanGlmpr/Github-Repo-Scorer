import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { HttpException, HttpStatus } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import {
  AxiosResponse,
  AxiosError,
  AxiosHeaders,
  InternalAxiosRequestConfig,
} from 'axios';
import { GithubService } from './github.service';
import { GithubSearchResponse } from '../../common/interfaces/github-repository.interface';

describe('GithubService', () => {
  let service: GithubService;
  let httpService: HttpService;

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

  beforeEach(async () => {
    // Clear any GITHUB_TOKEN to avoid auth header side effects in tests
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
      ],
    }).compile();

    service = module.get<GithubService>(GithubService);
    httpService = module.get<HttpService>(HttpService);
  });

  describe('searchRepositories', () => {
    it('should return search results on success', async () => {
      const axiosResponse: AxiosResponse<GithubSearchResponse> = {
        data: mockSearchResponse,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(axiosResponse));

      const result = await service.searchRepositories(
        'typescript',
        '2024-01-01',
        1,
        20,
      );

      expect(result).toEqual(mockSearchResponse);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].name).toBe('repo-a');
    });

    it('should call the GitHub API with correct parameters', async () => {
      const axiosResponse: AxiosResponse<GithubSearchResponse> = {
        data: mockSearchResponse,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      };

      const getSpy = jest
        .spyOn(httpService, 'get')
        .mockReturnValue(of(axiosResponse));

      await service.searchRepositories('python', '2024-06-01', 2, 30);

      expect(getSpy).toHaveBeenCalledWith('/search/repositories', {
        timeout: 5_000,
        params: {
          q: 'language:python created:>2024-06-01',
          sort: 'stars',
          order: 'desc',
          page: 2,
          per_page: 30,
        },
      });
    });

    it('should throw SERVICE_UNAVAILABLE on network errors', async () => {
      const networkError = new AxiosError(
        'Network Error',
        'ERR_NETWORK',
        undefined,
        undefined,
        undefined,
      );

      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(throwError(() => networkError));

      // Override sleep to avoid waiting in tests
      service.setBaseDelay(0);

      await expect(
        service.searchRepositories('typescript', '2024-01-01'),
      ).rejects.toThrow(HttpException);

      try {
        await service.searchRepositories('typescript', '2024-01-01');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    });

    it('should throw TOO_MANY_REQUESTS on 403 rate limit', async () => {
      const rateLimitError = new AxiosError(
        'Forbidden',
        '403',
        undefined,
        undefined,
        {
          status: 403,
          statusText: 'Forbidden',
          data: { message: 'API rate limit exceeded' },
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1609459200' },
          config: { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
        },
      );

      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(throwError(() => rateLimitError));

      try {
        await service.searchRepositories('typescript', '2024-01-01');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(error.getResponse()).toContain('rate limit exceeded');
      }
    });

    it('should throw BAD_REQUEST on 422 validation error', async () => {
      const validationError = new AxiosError(
        'Unprocessable Entity',
        '422',
        undefined,
        undefined,
        {
          status: 422,
          statusText: 'Unprocessable Entity',
          data: { message: 'Validation Failed' },
          headers: {},
          config: { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
        },
      );

      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(throwError(() => validationError));

      await expect(
        service.searchRepositories('typescript', '2024-01-01'),
      ).rejects.toThrow(HttpException);

      try {
        await service.searchRepositories('typescript', '2024-01-01');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(
          HttpStatus.BAD_REQUEST,
        );
      }
    });

    it('should throw BAD_GATEWAY on other server errors (after retries)', async () => {
      const serverError = new AxiosError(
        'Internal Server Error',
        '500',
        undefined,
        undefined,
        {
          status: 500,
          statusText: 'Internal Server Error',
          data: { message: 'Server error' },
          headers: {},
          config: { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
        },
      );

      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(throwError(() => serverError));

      // Speed up retries for tests
      service.setBaseDelay(0);

      await expect(
        service.searchRepositories('typescript', '2024-01-01'),
      ).rejects.toThrow(HttpException);

      try {
        await service.searchRepositories('typescript', '2024-01-01');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(
          HttpStatus.BAD_GATEWAY,
        );
      }
    });

    it('should retry on 5xx errors before failing', async () => {
      const serverError = new AxiosError(
        'Internal Server Error',
        '500',
        undefined,
        undefined,
        {
          status: 500,
          statusText: 'Internal Server Error',
          data: { message: 'Server error' },
          headers: {},
          config: { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
        },
      );

      const getSpy = jest
        .spyOn(httpService, 'get')
        .mockReturnValue(throwError(() => serverError));

      service.setBaseDelay(0);

      await expect(
        service.searchRepositories('typescript', '2024-01-01'),
      ).rejects.toThrow();

      // 1 initial + 3 retries = 4 total calls
      expect(getSpy).toHaveBeenCalledTimes(4);
    });
  });

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
        ],
      }).compile();

      module.get<GithubService>(GithubService);

      expect(mockHeaders['Authorization']).toBe('Bearer test-token-123');

      delete process.env.GITHUB_TOKEN;
    });
  });
});
