import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { RepositoriesModule } from './modules/repositories/repositories.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    CacheModule.register({
      isGlobal: true,
      ttl: 300_000, // 5 minutes (cache-manager v7 uses milliseconds)
      max: 100, // max cached items in memory
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, // 1-minute window (ms)
        limit: 20, // max 20 requests per minute per IP
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
