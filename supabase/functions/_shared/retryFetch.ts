/**
 * Retry-aware fetch wrapper for external API calls.
 * Automatically retries on 429 (rate limit) with exponential backoff.
 * 
 * Max 3 retries with delays: 3s → 6s → 12s (total ~21s, fits within edge fn budget).
 */

export interface RetryFetchOptions {
  /** Maximum number of retries on 429. Default: 3 */
  maxRetries?: number;
  /** Base delay in ms before first retry. Default: 3000 */
  baseDelayMs?: number;
  /** Max delay cap in ms. Default: 15000 */
  maxDelayMs?: number;
  /** Wall-clock start time — if close to edge fn timeout, stop retrying */
  wallClockStartMs?: number;
  /** Max wall-clock budget in ms. Default: 25000 */
  wallClockBudgetMs?: number;
}

export async function retryFetch(
  url: string,
  init: RequestInit,
  opts: RetryFetchOptions = {},
): Promise<Response> {
  const {
    maxRetries = 3,
    baseDelayMs = 3000,
    maxDelayMs = 15000,
    wallClockStartMs,
    wallClockBudgetMs = 25000,
  } = opts;

  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check wall-clock budget before retrying
    if (attempt > 0 && wallClockStartMs) {
      const elapsed = Date.now() - wallClockStartMs;
      // Reserve at least 5s for the actual request
      if (elapsed + 5000 > wallClockBudgetMs) {
        console.log(`retryFetch: wall-clock budget exhausted after ${attempt} attempts, returning last 429`);
        return lastResponse!;
      }
    }

    const res = await fetch(url, init);

    if (res.status !== 429) {
      return res;
    }

    lastResponse = res;

    if (attempt < maxRetries) {
      // Parse Retry-After header if available
      const retryAfter = res.headers.get("retry-after");
      let delay: number;
      if (retryAfter && !isNaN(Number(retryAfter))) {
        delay = Math.min(Number(retryAfter) * 1000, maxDelayMs);
      } else {
        delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      }
      console.log(`retryFetch: 429 received, retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // All retries exhausted — return the last 429 response
  return lastResponse!;
}
