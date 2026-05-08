# GitHub Repository Scorer

A production-ready NestJS backend service that fetches repositories from the GitHub Search API and assigns each repository a **popularity score** based on stars, forks, and recency of updates.

Follows a layered architecture: controller → service → domain → infrastructure.

## Features

- 🔍 **GitHub Repository Search** — Search by programming language and creation date
- 📊 **Popularity Scoring** — Weighted algorithm using stars, forks, and update recency
- ⚡ **In-Memory Caching** — 5-minute TTL to reduce GitHub API calls
- 🔄 **Retry Logic** — Exponential backoff for transient GitHub API failures
- 📖 **Swagger Documentation** — Interactive API docs at `/api/docs`
- 🛡️ **Production-Ready** — Global error handling, validation, and structured logging
- 🐳 **Dockerized** — Multi-stage build with non-root user
- 🧪 **Tested** — Comprehensive unit tests with Jest

---

## Tech Stack

| Tool              | Purpose                      |
| ----------------- | ---------------------------- |
| NestJS            | Application framework        |
| TypeScript        | Language (strict mode)       |
| Axios (HttpModule)| HTTP client for GitHub API   |
| class-validator   | DTO validation               |
| class-transformer | Query parameter transforms   |
| cache-manager     | In-memory response caching   |
| Swagger           | API documentation            |
| Jest              | Unit testing                 |
| ESLint + Prettier | Code quality & formatting    |

---

## Getting Started

### Prerequisites
⏱ Setup time: under 2 minutes

- **Node.js** >= 18
- **npm** >= 9

### Installation

```bash
# Clone the repository
git clone https://github.com/ErfanGlmpr/Github-Repo-Scorer.git
cd Github-Repo-Scorer

# Install dependencies
npm install

# Copy the environment file
cp .env.example .env
```

### Environment Variables

| Variable       | Required | Default | Description                                    |
| -------------- | -------- | ------- | ---------------------------------------------- |
| `GITHUB_TOKEN` | No       | —       | GitHub PAT for higher rate limits (5000 req/h)  |
| `PORT`         | No       | `3000`  | Port the application listens on                |

> **Tip:** Without a `GITHUB_TOKEN`, GitHub limits you to 10 requests/minute. Generate a token at [github.com/settings/tokens](https://github.com/settings/tokens).

### Running the Application

```bash
# Development (with watch mode)
npm run start:dev

# Production build
npm run build
npm run start:prod
```

The API will be available at `http://localhost:3000`.

### Running with Docker

The easiest way to run the application is using **Docker Compose**, which automatically handles building the image and loading your `.env` file.

```bash
# Build and start the container in the background
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop the container
docker-compose down
```


---

## API Usage

### Search Repositories

```
GET /repositories?language=typescript&created_after=2024-01-01&page=1&limit=10
```

#### Query Parameters

| Parameter       | Type   | Required | Default | Description                               |
| --------------- | ------ | -------- | ------- | ----------------------------------------- |
| `language`      | string | ✅       | —       | Programming language filter               |
| `created_after` | string | ✅       | —       | ISO 8601 date (repos created after this)  |
| `page`          | number | ❌       | `1`     | Page number for pagination                |
| `limit`         | number | ❌       | `20`    | Results per page (1–100)                  |

#### Example Response

```json
{
  "statusCode": 200,
  "data": [
    {
      "name": "vscode",
      "fullName": "microsoft/vscode",
      "url": "https://github.com/microsoft/vscode",
      "stars": 150000,
      "forks": 28000,
      "updatedAt": "2025-01-14T10:30:00Z",
      "score": 8.4521
    }
  ],
  "timestamp": "2025-01-15T12:00:00.000Z"
}
```

#### Example cURL

```bash
curl "http://localhost:3000/repositories?language=typescript&created_after=2024-01-01&page=1&limit=5"
```

### Health Check

```
GET /health
```

---

## Scoring Rationale

The popularity score is designed to surface repositories that are not only large in scale but also actively maintained.

### The Formula

```
score = 0.5 × log(1 + stars) 
      + 0.3 × log(1 + forks) 
      + 0.2 × exp(-0.05 × days_since_update)
```

### Component Analysis

| Component | Formula | Weight | Rationale |
| :--- | :--- | :--- | :--- |
| **Stars** | `log(1 + stars)` | 50% | Primary popularity signal. Log scaling prevents 100k+ star "mega-repos" from infinitely outscoring growing projects. |
| **Forks** | `log(1 + forks)` | 30% | Indicates utility and community reuse. Log scaling ensures a 10k fork repo isn't 10x better than a 1k fork repo. |
| **Recency** | `exp(-λ × days)` | 20% | Rewards active maintenance. Uses exponential decay (λ=0.05) to penalize stale projects. |

### Why λ = 0.05?

We chose a decay factor of **0.05** to provide a balanced "half-life" for maintenance:
*   **0 days ago:** 100% recency score.
*   **14 days ago:** ~50% recency score.
*   **30 days ago:** ~22% recency score.
*   **90 days ago:** ~1% recency score.

This ensures that a project updated within the last 2 weeks remains highly competitive, but one abandoned for 3 months loses its recency advantage almost entirely.

---

## Scripts Reference

| Script             | Description                       |
| ------------------ | --------------------------------- |
| `npm run start:dev`| Start in watch mode (development) |
| `npm run build`    | Compile TypeScript to JavaScript  |
| `npm run start:prod`| Start the production build       |
| `npm test`         | Run unit tests                    |
| `npm run test:cov` | Run tests with coverage report    |
| `npm run lint`     | Lint and auto-fix with ESLint     |
| `npm run format`   | Format code with Prettier         |

---

## License

UNLICENSED
