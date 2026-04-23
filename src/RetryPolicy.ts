import type { Options as AsyncRetryOptions } from 'async-retry';

export type RetryPolicyOptions = AsyncRetryOptions;

export const RetryPolicy = {
  NONE: { retries: 0 } satisfies RetryPolicyOptions,
  SHORT: { retries: 3, minTimeout: 100, factor: 2, randomize: true } satisfies RetryPolicyOptions,
  LONG: { retries: 5, minTimeout: 500, factor: 2, randomize: true } satisfies RetryPolicyOptions,
  HUGE: { retries: 10, minTimeout: 1000, factor: 2, randomize: true } satisfies RetryPolicyOptions,
} as const;

export type RetryPolicyName = keyof typeof RetryPolicy;
