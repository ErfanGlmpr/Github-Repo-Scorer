import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RepositoriesService } from './repositories.service';
import { GithubService } from '../github/github.service';
import { ScoringService } from '../scoring/scoring.service';
import { GithubSearchResponse } from '../../common/interfaces/github-repository.interface';

describe('RepositoriesService', () => {
  let service: RepositoriesService;
  let githubService: jest.Mocked<Pick<GithubService, 'searchRepositories'>>;

  const mockGithubResponse: GithubSearchResponse = {
    total_count: 2,
    incomplete_results: false,
    items: [
      {
        id: 1,
        name: 'repo-low',
        full_name: 'user/repo-low',
        html_url: 'https://github.com/user/repo-low',
        description: 'Low stars',
        stargazers_count: 10,
        forks_count: 2,
        language: 'TypeScript',
        created_at: '2024-06-01T00:00:00Z',
        updated_at: '2025-01-10T00:00:00Z',
      },
      {
        id: 2,
        name: 'repo-high',
        full_name: 'user/repo-high',
        html_url: 'https://github.com/user/repo-high',
        description: 'High stars',
        stargazers_count: 5000,
        forks_count: 1000,
        language: 'TypeScript',
        created_at: '2024-07-01T00:00:00Z',
        updated_at: '2025-01-12T00:00:00Z',
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoriesService,
        {
          provide: GithubService,
          useValue: {
            searchRepositories: jest.fn(),
          },
        },
        ScoringService,
      ],
    }).compile();

    service = module.get<RepositoriesService>(RepositoriesService);
    githubService = module.get(GithubService);
  });

  describe('findRepositories', () => {
    it('should return scored results sorted by score descending', async () => {
      githubService.searchRepositories.mockResolvedValue(mockGithubResponse);

      const results = await service.findRepositories(
        'typescript',
        '2024-01-01',
        1,
        20,
      );

      expect(results).toHaveLength(2);
      // repo-high has more stars, so it should be first
      expect(results[0].name).toBe('repo-high');
      expect(results[1].name).toBe('repo-low');

      // Verify descending score order
      expect(results[0].score).toBeGreaterThan(results[1].score);

      // Verify domain fields (camelCase)
      expect(results[0]).toHaveProperty('fullName');
      expect(results[0]).toHaveProperty('url');
      expect(results[0]).toHaveProperty('stars');
      expect(results[0]).toHaveProperty('forks');
      expect(results[0]).toHaveProperty('updatedAt');
    });

    it('should call GithubService with correct parameters', async () => {
      githubService.searchRepositories.mockResolvedValue(mockGithubResponse);

      await service.findRepositories('python', '2024-06-01', 2, 30);

      expect(githubService.searchRepositories).toHaveBeenCalledWith(
        'python',
        '2024-06-01',
        2,
        30,
      );
    });

    it('should reject future dates with BadRequestException', async () => {
      const futureDate = new Date(Date.now() + 86_400_000)
        .toISOString()
        .split('T')[0];

      await expect(
        service.findRepositories('typescript', futureDate, 1, 20),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid date strings', async () => {
      await expect(
        service.findRepositories('typescript', 'not-a-date', 1, 20),
      ).rejects.toThrow(BadRequestException);
    });

    it('should pass limit without clamping (handled by DTO/ValidationPipe)', async () => {
      githubService.searchRepositories.mockResolvedValue({
        total_count: 0,
        incomplete_results: false,
        items: [],
      });

      await service.findRepositories('typescript', '2024-01-01', 1, 150);

      expect(githubService.searchRepositories).toHaveBeenCalledWith(
        'typescript',
        '2024-01-01',
        1,
        150, // no longer clamped at service level
      );
    });

    it('should return empty array when GitHub returns no results', async () => {
      githubService.searchRepositories.mockResolvedValue({
        total_count: 0,
        incomplete_results: false,
        items: [],
      });

      const results = await service.findRepositories(
        'typescript',
        '2024-01-01',
        1,
        20,
      );

      expect(results).toEqual([]);
    });

    it('should propagate GitHub API errors', async () => {
      githubService.searchRepositories.mockRejectedValue(
        new Error('GitHub API failed'),
      );

      await expect(
        service.findRepositories('typescript', '2024-01-01', 1, 20),
      ).rejects.toThrow('GitHub API failed');
    });
  });
});
