import { GithubRepository } from '../interfaces/github-repository.interface';

/**
 * Clean domain model for a repository.
 * Decouples internal logic from raw GitHub API shapes.
 */
export interface Repository {
  id: number;
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Maps a raw GitHub API response object to our internal domain model.
 *
 * This layer exists so that:
 *  - The rest of the application never depends on GitHub's field naming
 *  - Date strings are parsed exactly once
 *  - If GitHub changes their API shape, only this mapper needs updating
 */
export function mapToDomain(repo: GithubRepository): Repository {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    url: repo.html_url,
    description: repo.description,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    language: repo.language,
    createdAt: new Date(repo.created_at),
    updatedAt: new Date(repo.updated_at),
  };
}
