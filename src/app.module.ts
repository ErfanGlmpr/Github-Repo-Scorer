import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { CacheModule } from './modules/cache/cache.module';
import { RepositoriesModule } from './modules/repositories/repositories.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    CacheModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, // 1-minute window (ms)
        limit: 40, // max 40 requests per minute per IP
      },
    ]),
    RepositoriesModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
