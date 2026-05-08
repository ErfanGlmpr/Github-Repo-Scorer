import { ScoringService } from './scoring.service';
import { Repository } from '../../common/mappers/repository.mapper';
import { SCORING_CONFIG } from './scoring.config';

describe('ScoringService', () => {
  let service: ScoringService;

  // Fixed reference time: 2025-01-15T00:00:00Z
  const NOW = new Date('2025-01-15T00:00:00Z').getTime();

  const makeRepo = (overrides: Partial<Repository> = {}): Repository => ({
    id: 1,
    name: 'test-repo',
    fullName: 'user/test-repo',
    url: 'https://github.com/user/test-repo',
    description: 'A test repository',
    stars: 100,
    forks: 50,
    language: 'TypeScript',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-14T00:00:00Z'), // 1 day ago from NOW
    ...overrides,
  });

  beforeEach(() => {
    service = new ScoringService();
  });

  // ─── calculateScore ──────────────────────────────────────────

  describe('calculateScore', () => {
    it('should return a positive score for a repo with stars and forks', () => {
      const score = service.calculateScore(makeRepo(), NOW);
      expect(score).toBeGreaterThan(0);
    });

    it('should return a higher score for more stars', () => {
      const low = service.calculateScore(makeRepo({ stars: 10 }), NOW);
      const high = service.calculateScore(makeRepo({ stars: 10000 }), NOW);
      expect(high).toBeGreaterThan(low);
    });

    it('should return a higher score for more forks', () => {
      const low = service.calculateScore(makeRepo({ forks: 5 }), NOW);
      const high = service.calculateScore(makeRepo({ forks: 5000 }), NOW);
      expect(high).toBeGreaterThan(low);
    });

    it('should give higher recency weight to recently updated repos', () => {
      const recent = service.calculateScore(
        makeRepo({ updatedAt: new Date('2025-01-14T00:00:00Z') }),
        NOW,
      );
      const old = service.calculateScore(
        makeRepo({ updatedAt: new Date('2024-01-01T00:00:00Z') }),
        NOW,
      );
      expect(recent).toBeGreaterThan(old);
    });

    it('should handle zero stars and zero forks', () => {
      const score = service.calculateScore(
        makeRepo({ stars: 0, forks: 0 }),
        NOW,
      );
      // Only the recency component contributes
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });

    it('should compute the correct value mathematically', () => {
      const repo = makeRepo({
        stars: 100,
        forks: 50,
        updatedAt: new Date('2025-01-15T00:00:00Z'), // exactly NOW
      });

      const { weights, recencyDecay } = SCORING_CONFIG;
      const expected =
        weights.stars * Math.log(1 + 100) +
        weights.forks * Math.log(1 + 50) +
        weights.recency * Math.exp(-recencyDecay * 0);

      expect(service.calculateScore(repo, NOW)).toBeCloseTo(expected, 4);
    });

    it('should apply exponential decay correctly for 10-day-old repo', () => {
      const tenDaysAgo = new Date(NOW - 10 * 86_400_000);
      const score = service.calculateScore(
        makeRepo({ stars: 0, forks: 0, updatedAt: tenDaysAgo }),
        NOW,
      );
      const expected =
        SCORING_CONFIG.weights.recency *
        Math.exp(-SCORING_CONFIG.recencyDecay * 10);
      expect(score).toBeCloseTo(expected, 4);
    });

    it('should clamp future updatedAt to 0 days (recency = 1)', () => {
      const futureDate = new Date(NOW + 86_400_000);
      const repo = makeRepo({ updatedAt: futureDate });
      const score = service.calculateScore(repo, NOW);

      const { weights, recencyDecay } = SCORING_CONFIG;
      const expected =
        weights.stars * Math.log(1 + repo.stars) +
        weights.forks * Math.log(1 + repo.forks) +
        weights.recency; // exp(0) = 1

      expect(score).toBeCloseTo(expected, 4);
    });

    // ─── Boundary / edge cases requested in upgrade ────────────

    it('should handle a very old repo (365 days)', () => {
      const oneYearAgo = new Date(NOW - 365 * 86_400_000);
      const score = service.calculateScore(
        makeRepo({ stars: 1000, forks: 500, updatedAt: oneYearAgo }),
        NOW,
      );
      // Recency should be nearly zero: exp(-0.05 * 365) ≈ 0
      const recencyPart =
        SCORING_CONFIG.weights.recency *
        Math.exp(-SCORING_CONFIG.recencyDecay * 365);
      expect(recencyPart).toBeLessThan(0.001);
      // But stars/forks still contribute meaningfully
      expect(score).toBeGreaterThan(3);
    });

    it('should handle a very recent repo (0 days)', () => {
      const score = service.calculateScore(
        makeRepo({ stars: 1, forks: 0, updatedAt: new Date(NOW) }),
        NOW,
      );
      // All three components should contribute
      const { weights } = SCORING_CONFIG;
      const expected =
        weights.stars * Math.log(2) +
        weights.forks * Math.log(1) +
        weights.recency * 1;
      expect(score).toBeCloseTo(expected, 4);
    });

    it('should produce higher scores for log(stars) despite diminishing returns', () => {
      const s100 = service.calculateScore(makeRepo({ stars: 100 }), NOW);
      const s200 = service.calculateScore(makeRepo({ stars: 200 }), NOW);
      const s300 = service.calculateScore(makeRepo({ stars: 300 }), NOW);

      // The gain from 100->200 should be greater than the gain from 200->300
      const delta1 = s200 - s100;
      const delta2 = s300 - s200;
      expect(delta2).toBeLessThan(delta1);
    });

    it('should give stars more weight than forks (by config)', () => {
      // Same numeric value, different field
      const starHeavy = service.calculateScore(
        makeRepo({ stars: 1000, forks: 0 }),
        NOW,
      );
      const forkHeavy = service.calculateScore(
        makeRepo({ stars: 0, forks: 1000 }),
        NOW,
      );
      expect(starHeavy).toBeGreaterThan(forkHeavy);
    });
  });

  // ─── scoreRepositories ────────────────────────────────────────

  describe('scoreRepositories', () => {
    it('should return results sorted by score descending', () => {
      const repos = [
        makeRepo({ name: 'low', stars: 1, forks: 1 }),
        makeRepo({ name: 'high', stars: 10000, forks: 5000 }),
        makeRepo({ name: 'mid', stars: 500, forks: 100 }),
      ];

      const scored = service.scoreRepositories(repos, NOW);

      expect(scored[0].name).toBe('high');
      expect(scored[1].name).toBe('mid');
      expect(scored[2].name).toBe('low');

      for (let i = 1; i < scored.length; i++) {
        expect(scored[i - 1].score).toBeGreaterThanOrEqual(scored[i].score);
      }
    });

    it('should include all expected fields in the response', () => {
      const scored = service.scoreRepositories([makeRepo()], NOW);

      expect(scored[0]).toHaveProperty('name');
      expect(scored[0]).toHaveProperty('fullName');
      expect(scored[0]).toHaveProperty('url');
      expect(scored[0]).toHaveProperty('stars');
      expect(scored[0]).toHaveProperty('forks');
      expect(scored[0]).toHaveProperty('updatedAt');
      expect(scored[0]).toHaveProperty('score');
      expect(typeof scored[0].score).toBe('number');
    });

    it('should handle an empty array', () => {
      expect(service.scoreRepositories([], NOW)).toEqual([]);
    });

    it('should skip repos that cause scoring errors without breaking', () => {
      const badRepo = makeRepo({ name: 'bad' });
      // Corrupt the updatedAt to force an error
      Object.defineProperty(badRepo, 'updatedAt', {
        get() {
          throw new Error('corrupt date');
        },
      });

      const goodRepo = makeRepo({ name: 'good' });
      const scored = service.scoreRepositories([badRepo, goodRepo], NOW);

      // The good repo should still be returned
      expect(scored).toHaveLength(1);
      expect(scored[0].name).toBe('good');
    });
  });
});
