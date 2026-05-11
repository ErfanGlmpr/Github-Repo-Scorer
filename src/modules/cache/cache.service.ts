import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Thin Redis cache-aside service.
 *
 * Design decisions:
 * - Wraps ioredis directly for full control over serialisation and TTL
 * - Swallows Redis errors gracefully (cache miss / no-op) so the app
 *   keeps working even when Redis is temporarily unavailable
 * - Uses `lazyConnect` to avoid blocking application startup
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });

    this.redis.connect().catch((err: unknown) => {
      this.logger.error('Failed to connect to Redis', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      this.logger.warn('Redis GET failed, treating as cache miss', { key });
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      this.logger.warn('Redis SET failed', { key });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.redis.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }
}
