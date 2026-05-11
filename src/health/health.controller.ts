import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import { CacheService } from '../modules/cache/cache.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly cacheService: CacheService) {}

  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({
    status: 200,
    description:
      'Application is running. Redis status indicates cache availability.',
  })
  async check(): Promise<{ status: string; redis: string; timestamp: string }> {
    const redisPing = await this.cacheService.ping();
    return {
      status: 'ok',
      redis: redisPing ? 'connected' : 'unavailable',
      timestamp: new Date().toISOString(),
    };
  }
}
