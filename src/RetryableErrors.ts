export const RetryableErrors = [
  'FIREBASE_NOT_AVAILABLE',
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
  'RESOURCE_EXHAUSTED',
  'ABORTED',
  'INTERNAL',
] as const;

export type RetryableErrorCode = (typeof RetryableErrors)[number];

export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return false;
  return (RetryableErrors as readonly string[]).includes(code);
}
