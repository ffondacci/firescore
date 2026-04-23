import { describe, expect, it, vi } from 'vitest';

import { FirestoreWrapper, RetryPolicy, isRetryableError } from '../src/index.js';

function makeWrapper(): FirestoreWrapper {
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
  } as const;
  return new FirestoreWrapper(stub as never);
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
    const wrapper = makeWrapper();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('transient'), { code: 'UNAVAILABLE' }))
      .mockRejectedValueOnce(Object.assign(new Error('transient'), { code: 'UNAVAILABLE' }))
      .mockResolvedValueOnce('ok');

    const result = await wrapper.executeWithRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('bails immediately on non-retryable errors', async () => {
    const wrapper = makeWrapper();
    const fn = vi.fn().mockRejectedValue(
      Object.assign(new Error('bad input'), { code: 'INVALID_ARGUMENT' }),
    );

    await expect(wrapper.executeWithRetry(fn)).rejects.toThrow('bad input');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honors an overriding retry policy', async () => {
    const wrapper = makeWrapper();
    const fn = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('x'), { code: 'UNAVAILABLE' }));

    await expect(wrapper.executeWithRetry(fn, RetryPolicy.NONE)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
