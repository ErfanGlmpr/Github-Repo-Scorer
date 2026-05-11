import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { GithubService } from '../github/github.service';
import { ScoringService, ScoredResult } from '../scoring/scoring.service';
import { mapToDomain } from '../../common/mappers/repository.mapper';

/** Metadata returned alongside scored results */
export interface SearchMeta {
  totalCount: number;
  accessibleCount: number;
  resultLimitReached: boolean;
  incompleteResults: boolean;
  source?: string;
  stale?: boolean;
  warning?: string;
}

export interface SearchResult {
  items: ScoredResult[];
  meta: SearchMeta;
}

/**
 * Orchestration service that:
 *  1. Validates input guardrails (date sanity, 1000-result cap)
 *  2. Translates client pagination into GitHub per_page=100 pagination
 *  3. Fetches GitHub pages (possibly two if the request spans a boundary)
 *  4. Slices the result window for the client
 *  5. Maps raw API data to domain models
 *  6. Enriches them with popularity scores
 *  7. Returns deterministically sorted results with metadata
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
  ): Promise<SearchResult> {
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

    // ─── GitHub 1,000-result cap ───────────────────────────────
    const clientOffset = (page - 1) * limit;
    if (clientOffset >= 1000) {
      this.logger.warn('Rejected pagination beyond 1000-result cap', {
        page,
        limit,
        clientOffset,
      });
      throw new BadRequestException(
        'GitHub Search API exposes a maximum of 1,000 results for a query. ' +
          `Requested offset ${clientOffset} exceeds this limit.`,
      );
    }

    // ─── Pagination translation ────────────────────────────────
    const githubPage1 = Math.floor(clientOffset / 100) + 1;
    const offsetWithinPage = clientOffset % 100;
    const endOffset = offsetWithinPage + limit;

    this.logger.log('Searching repositories', {
      language,
      createdAfter,
      clientPage: page,
      clientLimit: limit,
      githubPage: githubPage1,
      offsetWithinPage,
    });

    const startTime = Date.now();

    // ─── Fetch GitHub page(s) ──────────────────────────────────
    const result1 = await this.githubService.fetchGithubPage(
      language,
      createdAfter,
      githubPage1,
    );

    let allItems = result1.data.items;
    let staleMeta = result1.meta;

    // If the client window spans two GitHub 100-item pages, fetch the second
    if (endOffset > 100 && allItems.length === 100) {
      this.logger.log('Request spans two GitHub pages — fetching second page', {
        githubPage: githubPage1 + 1,
      });
      const result2 = await this.githubService.fetchGithubPage(
        language,
        createdAfter,
        githubPage1 + 1,
      );
      allItems = [...allItems, ...result2.data.items];
      // Propagate stale flag if either page is stale
      if (result2.meta?.stale) {
        staleMeta = result2.meta;
      }
    }

    const fetchDuration = Date.now() - startTime;
    this.logger.log('GitHub search completed', {
      itemCount: allItems.length,
      totalCount: result1.data.total_count,
      durationMs: fetchDuration,
    });

    // ─── Slice to client's requested window ────────────────────
    const sliced = allItems.slice(offsetWithinPage, offsetWithinPage + limit);

    // ─── Map to domain → score ─────────────────────────────────
    const domainRepos = sliced.map(mapToDomain);
    const scored = this.scoringService.scoreRepositories(domainRepos);

    // ─── Deterministic sort with stable tie-breaker ────────────
    scored.sort(
      (a, b) => b.score - a.score || a.fullName.localeCompare(b.fullName),
    );

    // ─── Build result metadata ─────────────────────────────────
    const totalCount = result1.data.total_count;
    const meta: SearchMeta = {
      totalCount,
      accessibleCount: Math.min(totalCount, 1000),
      resultLimitReached: totalCount > 1000,
      incompleteResults: result1.data.incomplete_results,
    };

    if (staleMeta?.stale) {
      meta.source = staleMeta.source;
      meta.stale = staleMeta.stale;
      meta.warning = staleMeta.warning;
    }

    return { items: scored, meta };
  }
}
