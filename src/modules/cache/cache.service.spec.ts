import { CacheService } from './cache.service';

/**
 * We mock ioredis at the module level so the CacheService constructor
 * receives a controllable fake Redis instance.
 */
const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  quit: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedis);
});

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CacheService();
  });

  describe('get', () => {
    it('should return parsed JSON on cache hit', async () => {
      const data = { total_count: 5, items: [] };
      mockRedis.get.mockResolvedValue(JSON.stringify(data));

      const result = await service.get<typeof data>('some-key');

      expect(result).toEqual(data);
      expect(mockRedis.get).toHaveBeenCalledWith('some-key');
    });

    it('should return null on cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.get('missing-key');

      expect(result).toBeNull();
    });

    it('should return null and not throw when Redis errors', async () => {
      mockRedis.get.mockRejectedValue(new Error('Connection refused'));

      const result = await service.get('fail-key');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should call Redis SET with correct key, value, and TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');
      const data = { foo: 'bar' };

      await service.set('my-key', data, 600);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'my-key',
        JSON.stringify(data),
        'EX',
        600,
      );
    });

    it('should not throw when Redis SET fails', async () => {
      mockRedis.set.mockRejectedValue(new Error('Connection refused'));

      await expect(
        service.set('fail-key', { data: 1 }, 300),
      ).resolves.toBeUndefined();
    });
  });

  describe('onModuleDestroy', () => {
    it('should call redis.quit', async () => {
      mockRedis.quit.mockResolvedValue('OK');

      await service.onModuleDestroy();

      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
});
