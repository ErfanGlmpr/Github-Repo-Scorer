/**
 * Centralised scoring configuration.
 *
 * Extracting these values makes the algorithm:
 *  - easy to tune without touching business logic
 *  - easy to test with different configurations
 *  - self-documenting (each constant has a clear name)
 */
export const SCORING_CONFIG = {
  weights: {
    /** Stars are the primary popularity signal (50%) */
    stars: 0.5,
    /** Forks indicate community engagement and reuse (30%) */
    forks: 0.3,
    /** Recency rewards actively maintained projects (20%) */
    recency: 0.2,
  },

  /**
   * Exponential decay factor for recency scoring.
   *
   * With λ = 0.05:
   *  - 0 days ago  → recency = 1.00 (100%)
   *  - 7 days ago  → recency ≈ 0.70 (70%)
   *  - 14 days ago → recency ≈ 0.50 (50%)
   *  - 30 days ago → recency ≈ 0.22 (22%)
   *  - 60 days ago → recency ≈ 0.05 (5%)
   *  - 90 days ago → recency ≈ 0.01 (1%)
   *
   * This provides a smooth curve that strongly favours recently
   * active projects without immediately penalising short inactivity.
   */
  recencyDecay: 0.05,

  /** Milliseconds in one day — used for date arithmetic. */
  msPerDay: 86_400_000,
} as const;
