import { glowLogger } from './glow-logger';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Label used in log messages to identify the operation */
  label?: string;
  /** If true, swallow the final error and return undefined instead of throwing */
  silent?: boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'label' | 'silent'>> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
};

/**
 * Execute an async function with exponential-backoff retries.
 *
 * On each failure the delay doubles (with jitter) up to maxDelayMs.
 * If all attempts fail, the last error is thrown unless `silent` is set.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_OPTIONS.maxAttempts;
  const baseDelayMs = opts?.baseDelayMs ?? DEFAULT_OPTIONS.baseDelayMs;
  const maxDelayMs = opts?.maxDelayMs ?? DEFAULT_OPTIONS.maxDelayMs;
  const label = opts?.label ?? 'withRetry';

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (attempt < maxAttempts) {
        const jitter = Math.random() * 0.3 + 0.85; // 0.85–1.15
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1) * jitter, maxDelayMs);
        glowLogger.warn(`${label}: attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(delay)}ms`, {
          attempt,
          error: errorMsg,
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        glowLogger.error(`${label}: all ${maxAttempts} attempts failed`, {
          error: errorMsg,
        });
      }
    }
  }

  if (opts?.silent) {
    return undefined as unknown as T;
  }
  throw lastError;
}
