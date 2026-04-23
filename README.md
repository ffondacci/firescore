# firescore

> Typed Node.js wrapper around `firebase-admin` and `@google-cloud/storage`.
> Multi-instance, retry & storage policies, pluggable logger, cursor pagination and real-time listeners.

[![node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org/)
[![typescript](https://img.shields.io/badge/typescript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/badge/license-ISC-lightgrey.svg)](#license)

```ts
import { FirInstance, FirestoreWrapper, RetryPolicy, ConsoleLogger } from 'firescore';

const instance = new FirInstance(serviceAccount, 'prod', {
  retryPolicy: RetryPolicy.LONG,
  logger: new ConsoleLogger('info'),
});

const db = new FirestoreWrapper(instance);

interface User { name: string; age: number }

const id = await db.pushDocument<User>('users', { name: 'Jane', age: 30 });
const user = await db.getDocument<User>(`users/${id}`);
```

## What's in the box

- **Multi-instance** Firebase apps, each with its own policies ([docs](./docs/getting-started.md#multiple-instances))
- **Typed CRUD** with generics ([docs](./docs/firestore.md))
- **Retry policies** with automatic bailing on non-retryable errors ([docs](./docs/retry-policy.md))
- **Storage policies** for auto-managed `createdAt` / `updatedAt` timestamps ([docs](./docs/storage-policy.md))
- **Cursor pagination** and **callback pagination** ([docs](./docs/pagination.md))
- **Real-time listeners** — `onDocumentSnapshot` / `onCollectionSnapshot` ([docs](./docs/listeners.md))
- **Collection group queries** ([docs](./docs/firestore.md#collection-groups))
- **Chunked batches** (Firestore's 500-ops cap respected automatically)
- **Cloud Storage helpers** — upload/download/signed URLs with safe streaming ([docs](./docs/storage.md))
- **Firebase Auth helpers** ([docs](./docs/auth.md))
- **Pluggable logger** — Noop, Console, Memory, or your own ([docs](./docs/logging.md))

## Install

```bash
npm install firescore firebase-admin @google-cloud/storage
```

Requires **Node.js ≥ 18**.

## Documentation

| Page | What's inside |
|------|---------------|
| [Getting started](./docs/getting-started.md) | Installation, first instance, multi-instance patterns |
| [Firestore reference](./docs/firestore.md) | Full `FirestoreWrapper` API |
| [Storage reference](./docs/storage.md) | Full `FirStorageWrapper` API |
| [Auth reference](./docs/auth.md) | Full `FirUserWrapper` API |
| [Retry policy](./docs/retry-policy.md) | Presets, custom policies, error classification |
| [Storage policy](./docs/storage-policy.md) | Timestamps, pagination defaults |
| [Pagination](./docs/pagination.md) | `queryPage` (cursor) vs `queryPaginate` (callback) |
| [Listeners](./docs/listeners.md) | `onDocumentSnapshot` / `onCollectionSnapshot` |
| [Logging](./docs/logging.md) | Built-in loggers, custom sinks |
| [Recipes](./docs/recipes.md) | Transactions, collection groups, multi-instance patterns |
| [Testing](./docs/testing.md) | Running the suite locally and in CI |

## Scripts

| Command                        | What it does                             |
|--------------------------------|------------------------------------------|
| `npm run build`                | Compile ESM + types to `dist/` via tsup  |
| `npm run typecheck`            | Strict `tsc --noEmit` on `src/`          |
| `npm test`                     | Run Vitest (unit + integration)          |
| `npm run test:watch`           | Vitest in watch mode                     |
| `npm run docs:sync-wiki`       | Mirror `docs/` into the GitHub Wiki      |
| `npm run docs:sync-wiki:dry`   | Preview wiki changes without pushing     |
| `npm run docs:sync-wiki:local` | Build wiki pages into `.wiki-build/`     |

## Running integration tests

```bash
export FIREBASE_CREDENTIALS_PATH=/absolute/path/to/service-account.json
npm test
```

Tests skip automatically when no credentials are provided. See [docs/testing.md](./docs/testing.md).

> ⚠️ **Never commit credentials.** The repo's `.gitignore` blocks `credentials/`,
> `*-firebase-adminsdk-*.json`, `*serviceAccount*.json` and similar patterns.

## License

ISC
