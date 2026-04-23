import { describe, expect, it, vi } from 'vitest';

import { FirestoreWrapper, MemoryLogger, RetryPolicy, isRetryableError } from '../src/index.js';

function makeWrapper(logger = new MemoryLogger()): {
  wrapper: FirestoreWrapper;
  logger: MemoryLogger;
} {
  // Bypass the real FirInstance — we only exercise executeWithRetry here.
  const stub = {
    firestore: {} as never,
    retryPolicy: { retries: 3, minTimeout: 1, factor: 1, randomize: false },
    storagePolicy: {
      addCreationTimestamp: false,
      creationTimestampField: 'createdAt',
      addUpdateTimestamp: false,
      updateTimestampField: 'updatedAt',
      pageSize: 10,
    },
    logger,
  } as const;
  return { wrapper: new FirestoreWrapper(stub as never), logger };
}

describe('isRetryableError', () => {
  it('returns true for known retryable codes', () => {
    expect(isRetryableError({ code: 'UNAVAILABLE' })).toBe(true);
    expect(isRetryableError({ code: 'DEADLINE_EXCEEDED' })).toBe(true);
  });

  it('returns false for unknown codes and non-errors', () => {
    expect(isRetryableError({ code: 'INVALID_ARGUMENT' })).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(new Error('boom'))).toBe(false);
  });
});

describe('FirestoreWrapper.executeWithRetry', () => {
  it('retries retryable errors then succeeds', async () => {
    const { wrapper, logger } = makeWrapper();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('transient'), { code: 'UNAVAILABLE' }))
      .mockRejectedValueOnce(Object.assign(new Error('transient'), { code: 'UNAVAILABLE' }))
      .mockResolvedValueOnce('ok');

    const result = await wrapper.executeWithRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);

    // Logger should have captured two retry attempts + one success info.
    const attempts = logger.entries.filter((e) => e.message === 'firestore.retry.attempt');
    const success = logger.entries.filter((e) => e.message === 'firestore.retry.succeeded');
    expect(attempts).toHaveLength(2);
    expect(success).toHaveLength(1);
  });

  it('bails immediately on non-retryable errors and logs the bail', async () => {
    const { wrapper, logger } = makeWrapper();
    const fn = vi.fn().mockRejectedValue(
      Object.assign(new Error('bad input'), { code: 'INVALID_ARGUMENT' }),
    );

    await expect(wrapper.executeWithRetry(fn)).rejects.toThrow('bad input');
    expect(fn).toHaveBeenCalledTimes(1);
    const bail = logger.entries.find((e) => e.message === 'firestore.retry.bail');
    expect(bail).toBeDefined();
    expect(bail?.context?.code).toBe('INVALID_ARGUMENT');
  });

  it('honors an overriding retry policy', async () => {
    const { wrapper } = makeWrapper();
    const fn = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('x'), { code: 'UNAVAILABLE' }));

    await expect(wrapper.executeWithRetry(fn, RetryPolicy.NONE)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
