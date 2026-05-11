# GitHub Repository Scorer

## 1. Project Overview
A production-ready NestJS backend service that:
- Searches GitHub repositories using the GitHub Repository Search API.
- Supports filtering by `language` and `created_after` date.
- Scores repositories using a custom popularity scoring algorithm based on stars, forks, and recency of updates.
- Returns paginated, scored repository results.
- Is explicitly designed around GitHub Search API constraints.

## 2. GitHub API Constraints
The GitHub Repository Search API imposes strict rate limits and pagination constraints that heavily influenced this application's design:
- **Unauthenticated search:** 10 requests per minute.
- **Authenticated search (Fine-grained PAT):** 30 requests per minute.
- **Maximum `per_page` value:** 100 results per page.
- **Maximum accessible results:** 1,000 results per search query.
- **Rate Limit Responses:** GitHub may return `403` or `429` for primary or secondary rate limits.
- **Headers:** GitHub provides rate-limit headers to monitor usage:
  - `x-ratelimit-limit`
  - `x-ratelimit-remaining`
  - `x-ratelimit-reset`
  - `retry-after`

The application is intentionally designed to reduce upstream GitHub calls and avoid exhausting the shared authenticated quota.

## 3. Production Readiness and Scalability
To ensure production-scale reliability and efficiency, several improvements have been implemented:

### A. GitHub Request Batching
- The public API accepts client `page` and `limit` parameters (e.g., `limit=20`).
- Internally, the service fetches GitHub pages using the maximum allowed `per_page=100`.
- Client pagination is seamlessly translated into GitHub pagination.
- Results are sliced locally before returning to the client.
- If a client request spans two GitHub pages, both required GitHub pages are fetched and merged.
- **Why:** This significantly reduces GitHub API calls and allows multiple client `page`/`limit` combinations to reuse the same upstream GitHub response.

### B. Pagination and Scoring Order
GitHub Search is the canonical source of result ordering. The API does not reorder paginated results by popularity score in the default search endpoint because doing so on partially fetched GitHub pages would make pagination inconsistent.

The service preserves GitHub's default best-match ordering, slices results according to client pagination, and then computes a popularity score for each returned repository.

The score is returned as metadata for each repository, but it is not used as the default pagination order.

A globally score-sorted result set would require fetching, scoring, and sorting the full accessible GitHub result window, up to GitHub's 1,000-result cap. This is intentionally avoided in the default path to keep the API scalable and predictable.

### C. Redis Distributed Cache
- GitHub search pages are cached in Redis using a cache-aside pattern.
- Cache keys are based on the normalized GitHub query (language, date), GitHub page number, and `per_page=100`.
- Different client limits can reuse the same cached GitHub page.
- Using Redis allows multiple application instances to share the same cache, enabling horizontal scaling.
- Implements a fresh TTL with a stale-cache fallback mechanism.

### D. Request Coalescing
- Concurrent identical cache misses are coalesced.
- Only one GitHub request is sent for the same uncached GitHub page.
- Other concurrent requests await the same in-flight promise.
- This actively prevents cache stampedes under high load.

### E. GitHub Global Rate Limiter
- All outbound GitHub Search calls go through a protected wrapper.
- The limiter uses a safe budget below GitHub’s authenticated 30 requests/minute limit.
- Concurrency is capped.
- This protects the shared GitHub token from being exhausted across the application.

### F. Retry and Rate-Limit Handling
- The app automatically retries transient GitHub failures.
- Retries handle `403` (secondary rate limits), `429` (too many requests), `5xx` (server errors), and network errors.
- The retry logic respects GitHub's `retry-after` and `x-ratelimit-reset` headers.
- Bad client requests (e.g., `400`, `422`) are not retried.

### G. Stale Cache Fallback
- If GitHub is unavailable or rate-limited (and retries fail), the service can return stale cached results when available.
- Response metadata explicitly indicates when stale data is returned (`"stale": true`).
- If no cache is available at all, the API returns a controlled error.

### H. Client-level Rate Limiting
- The API applies its own client/IP-level rate limiting.
- This is separate from the global GitHub limiter.
- This prevents a single aggressive client from consuming the shared GitHub API quota.

### I. 1,000-Result Cap Handling
- The service explicitly reports pagination state via response metadata:
  - `totalCount`
  - `accessibleCount`
  - `resultLimitReached`
  - `incompleteResults`
- Requests paginating beyond GitHub’s accessible 1,000-result window are rejected with a clear error.
- The API does not pretend that all GitHub results are retrievable.

## 4. Architecture
The application follows a layered architecture to cleanly separate concerns:

**Client → NestJS API → Validation & Rate Limiter → Repository Service → Redis Cache → GitHub Service → GitHub Search API**

- **Controller:** Validates request input and applies the client-facing API contract.
- **Repository Service:** Translates client pagination into GitHub pagination, checks cache, applies scoring, slices results, and builds response metadata.
- **Cache Service:** Reads/writes to Redis and supports fresh/stale cache behavior.
- **GitHub Service:** Owns outbound GitHub calls, applies global rate limiting, handles retries, and tracks GitHub rate-limit headers.

## 5. API Documentation

### Search Repositories
`GET /repositories`

#### Query Parameters
- `language` (required string): GitHub repository language filter.
- `created_after` (required ISO date): Filters repositories created after this date.
- `page` (optional number): Client-facing page number (default: 1).
- `limit` (optional number): Client-facing page size. `limit` must be between 1 and 100. Requests with `limit > 100` return `400 Bad Request`. (default: 20).

#### Example Request
```bash
curl "http://localhost:3000/repositories?language=typescript&created_after=2026-01-01&page=1&limit=20"
```

#### Example Response
```json
{
  "statusCode": 200,
  "data": {
    "items": [
      {
        "name": "openclaw",
        "fullName": "openclaw/openclaw",
        "url": "https://github.com/openclaw/openclaw",
        "stars": 370730,
        "forks": 76613,
        "createdAt": "2026-01-01T10:16:47.000Z",
        "updatedAt": "2026-05-11T10:28:09.000Z",
        "score": 9.99
      }
    ],
    "meta": {
      "totalCount": 7926852,
      "accessibleCount": 1000,
      "resultLimitReached": true,
      "incompleteResults": false,
      "orderBy": "github_best_match"
    }
  },
  "timestamp": "2026-05-11T10:28:14.869Z"
}
```

## 6. Environment Variables

Configure the application by creating a `.env` file (see `.env.example`):

```env
# GitHub Personal Access Token (recommended for 30 req/min limit)
GITHUB_TOKEN=your_token_here

# Application port
PORT=3000

# Redis configuration (required for distributed caching)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

## 7. Running Locally

**Prerequisites:** Node.js (v18+) and Docker.

### A. Manual Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env

# 3. Start Redis (required for caching)
docker compose up -d redis

# 4. Run the application
# Development mode (with hot-reload)
npm run start:dev

# Production mode
npm run start:prod
```

### B. Docker Setup (Fully Containerized)

You can run the entire stack (API + Redis) using Docker:

```bash
# Start all services
docker compose up -d --build

# Check status
docker compose ps

# View real-time logs
docker compose logs -f

# View logs for a specific service (e.g., the API)
docker compose logs -f api
```

The API will be available at `http://localhost:3000`. Interactive Swagger docs are at `/api/docs`.

## 8. Testing

The application includes comprehensive test coverage for scoring behavior, pagination translation, Redis cache behavior, request coalescing, GitHub retry/rate-limit handling, 1,000-result cap handling, and stale cache fallback.

```bash
# Run unit tests
npm run test

# Run end-to-end tests
npm run test:e2e
```

## 9. Error Handling

The application provides controlled error responses for failure scenarios:

- `GITHUB_RATE_LIMITED`: GitHub Search API rate limit exceeded.
- `GITHUB_UNAVAILABLE`: GitHub API is unreachable (network errors, 5xx after retries).
- `GITHUB_BAD_REQUEST`: GitHub rejected the query.
- Validation errors for invalid query parameters.
- Pagination errors if requesting beyond GitHub's 1,000-result cap.

**Example Error Response:**
```json
{
  "error": "GITHUB_RATE_LIMITED",
  "message": "GitHub API rate limit exceeded. Please try again later.",
  "retryAfter": 60
}
```

## 10. Design Decisions

- **`per_page=100` internally:** Maximizing the GitHub page size drastically reduces the number of upstream calls needed to satisfy client requests.
- **Redis vs. In-memory:** Redis was chosen for distributed caching to allow horizontal scaling of application instances without cache fragmentation.
- **Caching GitHub Pages:** By caching raw GitHub pages instead of the final client responses, different client `page`/`limit` combinations can reuse the same cached data.
- **Global Rate Limiting:** Actively protects the shared authenticated GitHub quota from being exhausted by application bursts.
- **Stale Cache Fallback:** Improves availability and resilience during GitHub outages or temporary rate limiting.
- **Query Splitting:** Intentionally not implemented to keep the solution concise, maintainable, and to avoid putting extra pressure on the GitHub API.
- **Authentication:** GitHub App authentication is not implemented as this is a backend assignment utilizing a single configured token, but it presents a future scaling path for a multi-tenant production system.

## 11. Known Limitations and Future Improvements

**Known Limitations:**
- GitHub Search explicitly limits access to only the first 1,000 results per query.
- A single fine-grained PAT still represents a shared, hard upstream quota (30 requests/minute).
- Search result freshness is bounded by the cache TTL.
- Stale results may be returned during GitHub rate limiting if a stale cache entry exists.

**Future Improvements:**
- Implement GitHub App authentication for per-installation rate limit scaling.
- Introduce distributed Redis locking for cross-instance request coalescing (currently coalescing is per-instance).
- Add a metrics dashboard to track cache hit rates and GitHub API quota usage.
- Implement query partitioning only if full dataset coverage becomes a strict product requirement.

## 12. Scoring Rationale (Preserved)

The popularity score surfaces repositories that are actively maintained and widely used.

**Formula:**
`score = 0.5 × log(1 + stars) + 0.3 × log(1 + forks) + 0.2 × exp(-0.05 × days_since_update)`

| Component | Weight | Rationale |
| :--- | :--- | :--- |
| **Stars** | 50% | Primary popularity signal. Log scaling prevents "mega-repos" from infinitely outscoring growing projects. |
| **Forks** | 30% | Indicates utility and community reuse. Log scaling ensures a 10k fork repo isn't 10x better than a 1k fork repo. |
| **Recency** | 20% | Rewards active maintenance. Uses exponential decay (λ=0.05) to penalize stale projects. |
