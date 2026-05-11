import { Injectable, Logger } from '@nestjs/common';
import { Repository } from '../../common/mappers/repository.mapper';
import { SCORING_CONFIG } from './scoring.config';

/**
 * Service responsible for computing a popularity score for GitHub repositories.
 *
 * Formula:
 *   score = W_stars × log(1 + stars)
 *         + W_forks × log(1 + forks)
 *         + W_recency × exp(−λ × daysSinceLastUpdate)
 *
 * Where:
 *   W_stars   = 0.5  (configured in SCORING_CONFIG)
 *   W_forks   = 0.3
 *   W_recency = 0.2
 *   λ         = 0.05 (recency decay factor)
 *   daysSinceLastUpdate = (now − repo.updatedAt) in days
 *
 * @see scoring.config.ts for configuration and rationale
 */
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  /**
   * Calculate the popularity score for a single domain repository.
   *
   * @param repo  Domain repository object
   * @param now   Reference timestamp (injectable for deterministic testing)
   * @returns A number ≥ 0 representing the repository's popularity
   */
  calculateScore(repo: Repository, now: number = Date.now()): number {
    const { weights, recencyDecay, msPerDay } = SCORING_CONFIG;

    const starsComponent = weights.stars * Math.log(1 + repo.stars);
    const forksComponent = weights.forks * Math.log(1 + repo.forks);

    const daysSinceUpdate = (now - repo.updatedAt.getTime()) / msPerDay;
    const recency = Math.exp(-recencyDecay * Math.max(0, daysSinceUpdate));
    const recencyComponent = weights.recency * recency;

    return starsComponent + forksComponent + recencyComponent;
  }

  /**
   * Score a list of domain repositories, returning enriched results
   * sorted descending by score.
   *
   * Individual scoring failures are caught, logged, and skipped
   * so one bad record cannot break the entire response.
   */
  scoreRepositories(
    repos: Repository[],
    now: number = Date.now(),
  ): ScoredResult[] {
    const results: ScoredResult[] = [];

    for (const repo of repos) {
      try {
        results.push({
          name: repo.name,
          fullName: repo.fullName,
          url: repo.url,
          stars: repo.stars,
          forks: repo.forks,
          createdAt: repo.createdAt.toISOString(),
          updatedAt: repo.updatedAt.toISOString(),
          score: Number(this.calculateScore(repo, now).toFixed(2)),
        });
      } catch (error) {
        this.logger.error({
          message: `Skipping repo "${repo.fullName}" due to scoring error`,
          error: error instanceof Error ? error.message : String(error),
          operation: 'scoring',
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }
}

/**
 * Shape returned by scoreRepositories — kept here to avoid circular deps.
 */
export interface ScoredResult {
  name: string;
  fullName: string;
  url: string;
  stars: number;
  forks: number;
  createdAt: string;
  updatedAt: string;
  score: number;
}
