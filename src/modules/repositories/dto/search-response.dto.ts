import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RepositoryResponseDto } from './repository-response.dto';

/**
 * Metadata about the search results, including GitHub's 1,000-result cap
 * and optional stale-cache indicators.
 */
export class SearchMetaDto {
  @ApiProperty({
    example: 42567,
    description: 'Total number of matching repositories reported by GitHub',
  })
  totalCount!: number;

  @ApiProperty({
    example: 1000,
    description:
      'Number of results actually accessible via the GitHub Search API (capped at 1,000)',
  })
  accessibleCount!: number;

  @ApiProperty({
    example: true,
    description:
      'Whether the total number of results exceeds the 1,000-result GitHub Search API limit',
  })
  resultLimitReached!: boolean;

  @ApiProperty({
    example: false,
    description:
      'Whether GitHub reported incomplete results due to timeout or other issues',
  })
  incompleteResults!: boolean;

  @ApiPropertyOptional({
    example: 'cache',
    description: 'Data source when serving from stale cache',
  })
  source?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the data is stale (served from expired cache)',
  })
  stale?: boolean;

  @ApiPropertyOptional({
    example:
      'GitHub API is currently unavailable or rate-limited; returned cached results.',
    description: 'Human-readable warning when serving stale data',
  })
  warning?: string;
}

/**
 * Full search response envelope containing scored items and metadata.
 */
export class SearchResponseDto {
  @ApiProperty({
    type: [RepositoryResponseDto],
    description: 'Scored and sorted repositories for the requested page',
  })
  items!: RepositoryResponseDto[];

  @ApiProperty({
    type: SearchMetaDto,
    description: 'Pagination and result metadata',
  })
  meta!: SearchMetaDto;
}
