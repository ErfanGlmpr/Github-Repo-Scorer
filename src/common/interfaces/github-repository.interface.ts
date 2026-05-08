/**
 * Represents the raw repository data returned from the GitHub Search API.
 * Only the fields we care about are typed here.
 *
 * NOTE: This is the *external* API shape. Internally, use the
 * `Repository` domain model from common/mappers/repository.mapper.ts.
 */
export interface GithubRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * GitHub Search API response wrapper.
 */
export interface GithubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GithubRepository[];
}
