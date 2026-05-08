import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { GithubService } from '../github/github.service';
import { ScoringService, ScoredResult } from '../scoring/scoring.service';
import { mapToDomain } from '../../common/mappers/repository.mapper';

/**
 * Orchestration service that:
 *  1. Validates input guardrails (date sanity)
 *  2. Fetches repositories from GitHub
 *  3. Maps raw API data to domain models
 *  4. Enriches them with popularity scores
 *  5. Logs timing for observability
 */
@Injectable()
export class RepositoriesService {
  private readonly logger = new Logger(RepositoriesService.name);

  constructor(
    private readonly githubService: GithubService,
    private readonly scoringService: ScoringService,
  ) {}

  /**
   * Search for repositories matching the given criteria and return
   * them sorted by computed popularity score (descending).
   */
  async findRepositories(
    language: string,
    createdAfter: string,
    page: number,
    limit: number,
  ): Promise<ScoredResult[]> {
    // ─── Input guardrails ──────────────────────────────────────
    const createdDate = new Date(createdAfter);
    if (isNaN(createdDate.getTime())) {
      throw new BadRequestException(
        `Invalid date: "${createdAfter}" is not a valid ISO 8601 date`,
      );
    }
    if (createdDate > new Date()) {
      throw new BadRequestException(
        'created_after cannot be a date in the future',
      );
    }

    // Enforce upper bound even if DTO validation is bypassed
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);

    // ─── Fetch & transform ─────────────────────────────────────
    this.logger.log({
      message: 'Searching repositories',
      language,
      createdAfter,
      page: safePage,
      limit: safeLimit,
    });

    const startTime = Date.now();

    const searchResult = await this.githubService.searchRepositories(
      language,
      createdAfter,
      safePage,
      safeLimit,
    );

    const fetchDuration = Date.now() - startTime;
    this.logger.log({
      message: 'GitHub search completed',
      itemCount: searchResult.items.length,
      totalCount: searchResult.total_count,
      durationMs: fetchDuration,
    });

    // ─── Map to domain → score → return ────────────────────────
    const domainRepos = searchResult.items.map(mapToDomain);

    return this.scoringService.scoreRepositories(domainRepos);
  }
}
