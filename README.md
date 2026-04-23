# firescore

> Typed Node.js wrapper around `firebase-admin` and `@google-cloud/storage` with multi-instance support, retry policies and storage policies.

A TypeScript rewrite of the original FireCore, with strict typing, cursor
pagination, chunked batches, proper retry bailing and cleaner Storage APIs.

## Features

- **Multi-instance** — create as many named Firebase apps as you need, each with its own credentials, retry and storage policies.
- **Typed CRUD** — `FirestoreWrapper` is generic: `getDocument<User>(...)`, `queryDocuments<Product>(...)`, `BatchUpdate<T>`.
- **Retry policies** — `NONE | SHORT | LONG | HUGE` presets on top of `async-retry`, with automatic bailing on non-retryable errors (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`, `ABORTED`, `INTERNAL`).
- **Storage policies** — automatic `createdAt` / `updatedAt` timestamps, configurable per instance or per call.
- **Cursor pagination** — `queryPaginate` iterates large collections without blowing the stack.
- **Chunked batches** — `setDocumentsInBatches`, `batchUpdateDocuments`, `batchDeleteDocuments`, `pushDocumentInBatches` automatically respect Firestore's 500-ops cap.
- **Storage helpers** — upload/download with auto-gzip detection, signed URLs, safe streaming with `pipeline`.
- **Auth helpers** — typed wrappers over `firebase-admin/auth`.

## Install

```bash
npm install firescore firebase-admin @google-cloud/storage
```

Requires Node.js ≥ 18.

## Quick start

```ts
import {
  FirInstance,
  FirestoreWrapper,
  FirStorageWrapper,
  FirUserWrapper,
  RetryPolicy,
} from 'firescore';

import serviceAccount from './credentials/service-account.json' with { type: 'json' };

const instance = new FirInstance(serviceAccount, serviceAccount.project_id!, {
  retryPolicy: RetryPolicy.LONG,
  storagePolicy: {
    addCreationTimestamp: true,
    addUpdateTimestamp: true,
    pageSize: 100,
  },
});

const db = new FirestoreWrapper(instance);
const storage = new FirStorageWrapper(instance);
const users = new FirUserWrapper(instance);

interface User {
  name: string;
  age: number;
}

const id = await db.pushDocument<User>('users', { name: 'Jane', age: 30 });
const user = await db.getDocument<User>(`users/${id}`);
```

### Multiple instances

```ts
const prod = new FirInstance(prodCreds, 'prod');
const staging = new FirInstance(stagingCreds, 'staging');

const prodDb = new FirestoreWrapper(prod);
const stagingDb = new FirestoreWrapper(staging);
```

### Retry policies

`executeWithRetry` wraps any async function. Non-retryable errors bail
immediately; retryable ones are retried according to the policy.

```ts
await db.getDocument('users/123', RetryPolicy.HUGE);

await db.executeWithRetry(
  async () => someCustomFirestoreCall(),
  { retries: 7, minTimeout: 200, factor: 2, randomize: true },
);
```

Built-in presets:

| Name   | Retries | Min timeout | Factor |
|--------|---------|-------------|--------|
| NONE   | 0       | –           | –      |
| SHORT  | 3       | 100 ms      | 2      |
| LONG   | 5       | 500 ms      | 2      |
| HUGE   | 10      | 1000 ms     | 2      |

### Pagination

```ts
await db.queryPaginate<User>('users', {
  filters: [{ field: 'active', op: '==', value: true }],
  orderBy: [{ field: 'createdAt', direction: 'desc' }],
  pageSize: 100,
  onDocument: async (user) => {
    console.log(user.id, user.name);
  },
  onComplete: () => console.log('done'),
});
```

### Transactions

```ts
await db.performTransaction(async (tx) => {
  const refA = db.getDocumentRef('users/a');
  const refB = db.getDocumentRef('users/b');
  const [a, b] = await Promise.all([tx.get(refA), tx.get(refB)]);
  tx.update(refA, { balance: a.data()!.balance - 30 });
  tx.update(refB, { balance: b.data()!.balance + 30 });
});
```

### Storage

```ts
// Upload a file (gzip auto-disabled for media)
await storage.uploadFile('/tmp/image.jpg', 'photos/image.jpg');

// Download
await storage.downloadFileToLocalPath('my-bucket', 'photos/image.jpg', '/tmp/out.jpg');

// Signed URL, valid 1h
const url = await storage.generateSignedUrl('my-bucket', 'photos/image.jpg');
```

## API overview

| Class              | Purpose                                                 |
|--------------------|---------------------------------------------------------|
| `FirInstance`      | Named Firebase app + retry / storage policies.          |
| `FirestoreWrapper` | CRUD, batches, pagination, transactions on Firestore.   |
| `FirStorageWrapper`| Cloud Storage: upload, download, signed URLs, metadata. |
| `FirUserWrapper`   | Firebase Auth helpers.                                  |
| `RetryPolicy`      | Preset retry configurations.                            |
| `RetryableErrors`  | Which error codes trigger retries.                      |

Full types are generated into `dist/index.d.ts`.

## Scripts

| Command            | What it does                                |
|--------------------|---------------------------------------------|
| `npm run build`    | Compile ESM + types to `dist/` via tsup.    |
| `npm run typecheck`| `tsc --noEmit` over `src/`.                 |
| `npm test`         | Run Vitest (unit + integration).            |
| `npm run test:watch` | Vitest in watch mode.                     |

## Running integration tests

Integration tests hit a real Firestore project. They auto-skip when no
credentials are available.

Point to a service-account JSON one of two ways:

```bash
export FIREBASE_CREDENTIALS_PATH=/absolute/path/to/service-account.json
npm test
```

or drop the file at `./credentials/credential-helper.json` (that directory is
gitignored).

**⚠️ Never commit credentials.** The repo's `.gitignore` blocks `credentials/`,
`*-firebase-adminsdk-*.json`, `*serviceAccount*.json` and similar patterns.

## Notable fixes vs. the original FireCore (JS)

- `storagePolicy.addCreationTimestamp || true` → `??` (was always `true`).
- `executeWithRetry` now truly bails on non-retryable errors instead of re-throwing in the retry loop.
- `uploadFile` was defined twice → merged into one typed API.
- `downloadFileToLocalPath` now awaits the stream via `stream/promises.pipeline`.
- `queryPaginate` is now iterative — no stack overflow on large datasets.
- Batches are chunked to respect Firestore's 500-op limit.
- `exportCollectionsToBucket` / `importCollectionsFromBucket` were referring to a non-existent `adminClient` and have been removed (would need `@google-cloud/firestore-admin` to reintroduce cleanly).

## License

ISC
