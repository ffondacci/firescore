# Retry policy

Every Firestore read/write in `FirestoreWrapper` goes through
`executeWithRetry`. The policy decides:

- How many retries to attempt
- How long to wait between them
- How to back off

**Non-retryable errors short-circuit immediately** — the retry loop only
covers transient server errors.

## Presets

```ts
import { RetryPolicy } from 'firescore';
```

| Preset   | Retries | Min timeout | Factor | Randomize |
|----------|---------|-------------|--------|-----------|
| `NONE`   | 0       | —           | —      | —         |
| `SHORT`  | 3       | 100 ms      | 2      | ✅        |
| `LONG`   | 5       | 500 ms      | 2      | ✅        |
| `HUGE`   | 10      | 1000 ms     | 2      | ✅        |

`FirInstance` defaults to `RetryPolicy.SHORT` if nothing is passed.

## Per-instance default

```ts
const instance = new FirInstance(creds, 'prod', {
  retryPolicy: RetryPolicy.LONG,
});
```

## Per-call override

```ts
await db.getDocument('users/123', RetryPolicy.HUGE);
await db.setDocument('audit/xxx', payload, { retries: 1, minTimeout: 50 });
```

## Custom options

Any [`async-retry`](https://github.com/vercel/async-retry#api) option is
accepted:

```ts
import type { RetryPolicyOptions } from 'firescore';

const aggressive: RetryPolicyOptions = {
  retries: 7,
  minTimeout: 200,
  maxTimeout: 10_000,
  factor: 2,
  randomize: true,
};
```

## Retryable error codes

Defined in `RetryableErrors`:

- `FIREBASE_NOT_AVAILABLE`
- `UNAVAILABLE`
- `DEADLINE_EXCEEDED`
- `RESOURCE_EXHAUSTED`
- `ABORTED`
- `INTERNAL`

Anything else (e.g. `INVALID_ARGUMENT`, `PERMISSION_DENIED`, `NOT_FOUND`)
bails without retry — broken code or broken permissions don't benefit from
retries.

Check an error yourself with:

```ts
import { isRetryableError } from 'firescore';

try {
  await db.getDocument('...');
} catch (err) {
  if (isRetryableError(err)) {
    // will have been retried already — escalate
  } else {
    // programmer / config error
  }
}
```

## Using the retry loop on arbitrary code

`executeWithRetry` is exposed — use it for non-Firestore code that should
follow the same policy:

```ts
const response = await db.executeWithRetry(
  async () => fetch('https://api.example.com/...'),
  RetryPolicy.LONG,
);
```

## Logging

Retry events are logged via the injected [`Logger`](./logging.md):

| Event                        | Level | Context                      |
|------------------------------|-------|------------------------------|
| `firestore.retry.attempt`    | warn  | `{ attempt, code, message }` |
| `firestore.retry.succeeded`  | info  | `{ attempt }`                |
| `firestore.retry.bail`       | warn  | `{ attempt, code, message }` |

Plug in a `ConsoleLogger('debug')` to see every attempt.
