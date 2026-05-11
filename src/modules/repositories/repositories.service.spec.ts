import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RepositoriesService } from './repositories.service';
import { GithubService, GithubPageResult } from '../github/github.service';
import { ScoringService } from '../scoring/scoring.service';
import { GithubRepository } from '../../common/interfaces/github-repository.interface';

describe('RepositoriesService', () => {
  let service: RepositoriesService;
  let githubService: jest.Mocked<Pick<GithubService, 'fetchGithubPage'>>;

  /** Create N fake repositories with sequential IDs */
  function makeItems(count: number, startId: number = 1): GithubRepository[] {
    return Array.from({ length: count }, (_, i) => ({
      id: startId + i,
      name: `repo-${startId + i}`,
      full_name: `user/repo-${startId + i}`,
      html_url: `https://github.com/user/repo-${startId + i}`,
      description: `Repo ${startId + i}`,
      stargazers_count: 1000 - (startId + i), // descending stars for deterministic order
      forks_count: 100,
      language: 'TypeScript',
      created_at: '2024-06-01T00:00:00Z',
      updated_at: '2025-01-10T00:00:00Z',
    }));
  }

  /** Wrap items in a GithubPageResult */
  function makePageResult(
    items: GithubRepository[],
    totalCount: number = 500,
    stale?: boolean,
  ): GithubPageResult {
    const result: GithubPageResult = {
      data: { total_count: totalCount, incomplete_results: false, items },
    };
    if (stale) {
      result.meta = {
        source: 'cache',
        stale: true,
        warning:
          'GitHub API is currently unavailable or rate-limited; returned cached results.',
      };
    }
    return result;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoriesService,
        {
          provide: GithubService,
          useValue: {
            fetchGithubPage: jest.fn(),
          },
        },
        ScoringService,
      ],
    }).compile();

    service = module.get<RepositoriesService>(RepositoriesService);
    githubService = module.get(GithubService);
  });

  // ─── Pagination translation ──────────────────────────────

  describe('pagination translation', () => {
    it('page=1&limit=20 → fetches GitHub page 1, returns items 0..19', async () => {
      const items = makeItems(100);
      githubService.fetchGithubPage.mockResolvedValue(makePageResult(items));

      const result = await service.findRepositories(
        'typescript',
        '2024-01-01',
        1,
        20,
      );

      expect(githubService.fetchGithubPage).toHaveBeenCalledWith(
        'typescript',
        '2024-01-01',
        1, // github page
      );
      expect(result.items).toHaveLength(20);
    });

    it('page=3&limit=20 → fetches GitHub page 1, returns items 40..59', async () => {
      const items = makeItems(100);
      githubService.fetchGithubPage.mockResolvedValue(makePageResult(items));

      const result = await service.findRepositories(
        'typescript',
        '2024-01-01',
        3,
        20,
      );

      // Client offset = (3-1)*20 = 40, GitHub page = floor(40/100)+1 = 1
      expect(githubService.fetchGithubPage).toHaveBeenCalledWith(
        'typescript',
        '2024-01-01',
        1,
      );
      expect(result.items).toHaveLength(20);
    });

    it('page=6&limit=20 → fetches GitHub page 2, returns items from offset 0', async () => {
      const items = makeItems(100, 101);
      githubService.fetchGithubPage.mockResolvedValue(makePageResult(items));

      const result = await service.findRepositories(
        'typescript',
        '2024-01-01',
        6,
        20,
      );

      // Client offset = (6-1)*20 = 100, GitHub page = floor(100/100)+1 = 2
      expect(githubService.fetchGithubPage).toHaveBeenCalledWith(
        'typescript',
        '2024-01-01',
        2,
      );
      expect(result.items).toHaveLength(20);
    });

    it('should fetch two GitHub pages when request spans a page boundary', async () => {
      const page1Items = makeItems(100, 1);
      const page2Items = makeItems(100, 101);

      githubService.fetchGithubPage
        .mockResolvedValueOnce(makePageResult(page1Items))
        .mockResolvedValueOnce(makePageResult(page2Items));

      // page=5&limit=30 → offset=120, but that's > 100 on page 1
      // Actually: page=5&limit=30 → offset=(5-1)*30=120 → ghPage=floor(120/100)+1=2
      // offset within page = 120%100=20, end = 20+30=50 — fits in one page
      // Let's use a case that actually spans: page=2&limit=80 → offset=80, end=160
      const result = await service.findRepositories(
        'typescript',
        '2024-01-01',
        2,
        80,
      );

      // offset=80, ghPage=1, offsetWithin=80, end=160 > 100 → fetch pages 1 and 2
      expect(githubService.fetchGithubPage).toHaveBeenCalledTimes(2);
      expect(githubService.fetchGithubPage).toHaveBeenCalledWith(
        'typescript',
        '2024-01-01',
        1,
      );
      expect(githubService.fetchGithubPage).toHaveBeenCalledWith(
        'typescript',
        '2024-01-01',
        2,
      );
      expect(result.items).toHaveLength(80);
    });
  });

  // ─── 1,000-result cap ────────────────────────────────────

  describe('1000-result cap', () => {
    it('should reject page requests beyond accessible 1000 results', async () => {
      // page=51&limit=20 → offset=1000 → should reject
      await expect(
        service.findRepositories('typescript', '2024-01-01', 51, 20),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.findRepositories('typescript', '2024-01-01', 51, 20),
      ).rejects.toThrow(/1,000 results/);
    });

    it('should return accessibleCount and resultLimitReached metadata', async () => {
      const items = makeItems(20);
      githubService.fetchGithubPage.mockResolvedValue(
        makePageResult(items, 50_000), // total_count > 1000
      );

      const result = await service.findRepositories(
        'typescript',
        '2024-01-01',
        1,
        20,
      );

      expect(result.meta.totalCount).toBe(50_000);
      expect(result.meta.accessibleCount).toBe(1000);
      expect(result.meta.resultLimitReached).toBe(true);
    });

    it('should report resultLimitReached=false when under 1000', async () => {
      const items = makeItems(20);
      githubService.fetchGithubPage.mockResolvedValue(
        makePageResult(items, 42),
      );

      const result = await service.findRepositories(
        'typescript',
        '2024-01-01',
        1,
        20,
      );

      expect(result.meta.totalCount).toBe(42);
      expect(result.meta.accessibleCount).toBe(42);
      expect(result.meta.resultLimitReached).toBe(false);
    });
  });

  // ─── Ordering ─────────────────────────────────────────────

  describe('ordering', () => {
    it('should return results sorted by score descending with stable tie-breaker', async () => {
      const items = makeItems(5);
      githubService.fetchGithubPage.mockResolvedValue(makePageResult(items));

      const result = await service.findRepositories(
        'typescript',
        '2024-01-01',
        1,
        5,
      );

      for (let i = 1; i < result.items.length; i++) {
        const prev = result.items[i - 1];
        const curr = result.items[i];
        if (prev.score === curr.score) {
          // Tie-breaker: fullName ascending
          expect(
            prev.fullName.localeCompare(curr.fullName),
          ).toBeLessThanOrEqual(0);
        } else {
          expect(prev.score).toBeGreaterThan(curr.score);
        }
      }
    });
  });

  // ─── Stale metadata propagation ───────────────────────────

  describe('stale metadata', () => {
    it('should propagate stale cache metadata in response', async () => {
      const items = makeItems(20);
      githubService.fetchGithubPage.mockResolvedValue(
        makePageResult(items, 500, true), // stale=true
      );

      const result = await service.findRepositories(
        'typescript',
        '2024-01-01',
        1,
        20,
      );

      expect(result.meta.stale).toBe(true);
      expect(result.meta.source).toBe('cache');
      expect(result.meta.warning).toBeDefined();
    });
  });

  // ─── Input validation ────────────────────────────────────

  describe('input validation', () => {
    it('should reject future dates', async () => {
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
  });

  // ─── Edge cases ───────────────────────────────────────────

  describe('edge cases', () => {
    it('should return empty items when GitHub returns no results', async () => {
      githubService.fetchGithubPage.mockResolvedValue(makePageResult([], 0));

      const result = await service.findRepositories(
        'typescript',
        '2024-01-01',
        1,
        20,
      );

      expect(result.items).toEqual([]);
      expect(result.meta.totalCount).toBe(0);
    });

    it('should propagate GitHub API errors', async () => {
      githubService.fetchGithubPage.mockRejectedValue(
        new Error('GitHub API failed'),
      );

      await expect(
        service.findRepositories('typescript', '2024-01-01', 1, 20),
      ).rejects.toThrow('GitHub API failed');
    });
  });
});
