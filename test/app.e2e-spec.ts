import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { LoggingInterceptor } from '../src/common/interceptors/logging.interceptor';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('Repositories API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(
      new LoggingInterceptor(),
      new TransformInterceptor(),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('should return 200 with status ok', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          const body = res.body as {
            data: { status: string; timestamp: string };
          };
          expect(body.data.status).toBe('ok');
          expect(body.data.timestamp).toBeDefined();
        });
    });
  });

  describe('GET /repositories', () => {
    it('should return 400 when language is missing', () => {
      return request(app.getHttpServer())
        .get('/repositories?created_after=2024-01-01')
        .expect(400);
    });

    it('should return 400 when created_after is missing', () => {
      return request(app.getHttpServer())
        .get('/repositories?language=typescript')
        .expect(400);
    });

    it('should return 400 when created_after is invalid', () => {
      return request(app.getHttpServer())
        .get('/repositories?language=typescript&created_after=not-a-date')
        .expect(400);
    });

    it('should return 400 when limit exceeds 100', () => {
      return request(app.getHttpServer())
        .get(
          '/repositories?language=typescript&created_after=2024-01-01&limit=200',
        )
        .expect(400);
    });

    it('should return 400 when page is 0', () => {
      return request(app.getHttpServer())
        .get(
          '/repositories?language=typescript&created_after=2024-01-01&page=0',
        )
        .expect(400);
    });

    it('should return 200 and mapped fields for a valid request', async () => {
      const response = await request(app.getHttpServer())
        .get(
          '/repositories?language=typescript&created_after=2024-01-01&limit=1',
        )
        .expect(200);

      const body = response.body as { data: any[] };
      const items = body.data;
      if (items.length > 0) {
        const item = items[0] as Record<string, any>;
        expect(item).toHaveProperty('fullName');
        expect(item).toHaveProperty('url');
        expect(item).toHaveProperty('stars');
        expect(item).toHaveProperty('forks');
        expect(item).toHaveProperty('updatedAt');
        expect(item).not.toHaveProperty('full_name');
        expect(item).not.toHaveProperty('stargazers_count');
      }
    });
  });
});
