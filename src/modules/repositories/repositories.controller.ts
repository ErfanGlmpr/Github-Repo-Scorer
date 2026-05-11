import { Controller, Get, Query, Logger } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RepositoriesService } from './repositories.service';
import { SearchRepositoriesDto } from './dto/search-repositories.dto';
import { SearchResponseDto } from './dto/search-response.dto';

@ApiTags('Repositories')
@Controller('repositories')
export class RepositoriesController {
  private readonly logger = new Logger(RepositoriesController.name);

  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Get()
  @ApiOperation({
    summary: 'Search GitHub repositories by language',
    description:
      'Fetches repositories from GitHub matching the given language and creation date, ' +
      'then enriches each result with a computed popularity score based on stars, forks, and recency.',
  })
  @ApiResponse({
    status: 200,
    description: 'Scored repositories with pagination metadata',
    type: SearchResponseDto,
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
  ): Promise<SearchResponseDto> {
    this.logger.log('Incoming search repositories request', {
      language: query.language,
      createdAfter: query.created_after,
      page: query.page,
      limit: query.limit,
    });

    return this.repositoriesService.findRepositories(
      query.language,
      query.created_after,
      query.page,
      query.limit,
    );
  }
}
