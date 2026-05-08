import {
  Controller,
  Get,
  Query,
  UseInterceptors,
  Logger,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { RepositoriesService } from './repositories.service';
import { SearchRepositoriesDto } from './dto/search-repositories.dto';
import { RepositoryResponseDto } from './dto/repository-response.dto';

@ApiTags('Repositories')
@Controller('repositories')
@UseInterceptors(CacheInterceptor)
export class RepositoriesController {
  private readonly logger = new Logger(RepositoriesController.name);

  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Get()
  @CacheTTL(300_000) // 5 minutes (cache-manager v7 uses milliseconds)
  @ApiOperation({
    summary: 'Search GitHub repositories by language',
    description:
      'Fetches repositories from GitHub matching the given language and creation date, ' +
      'then enriches each result with a computed popularity score based on stars, forks, and recency.',
  })
  @ApiResponse({
    status: 200,
    description:
      'List of scored repositories sorted by popularity (descending)',
    type: [RepositoryResponseDto],
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (GitHub API or application throttle)',
  })
  @ApiResponse({ status: 502, description: 'GitHub API error' })
  @ApiResponse({ status: 503, description: 'GitHub API unreachable' })
  async searchRepositories(
    @Query() query: SearchRepositoriesDto,
  ): Promise<RepositoryResponseDto[]> {
    this.logger.log({
      message: 'Incoming search repositories request',
      query,
    });
    return this.repositoriesService.findRepositories(
      query.language,
      query.created_after,
      query.page,
      query.limit,
    );
  }
}
