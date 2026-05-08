import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GithubService } from './github.service';

@Module({
  imports: [
    HttpModule.register({
      baseURL: 'https://api.github.com',
      timeout: 10_000,
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    }),
  ],
  providers: [GithubService],
  exports: [GithubService],
})
export class GithubModule {}
