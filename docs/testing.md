# Testing

## Scripts

```bash
npm run typecheck      # strict tsc --noEmit on src/
npm test               # vitest run
npm run test:watch     # vitest watch
```

## Test layout

```
tests/
├── helpers/
│   └── credentials.ts       # tryLoadCredentials + uniqueAppName
├── firestoreWrapper.test.ts # Firestore CRUD + modern APIs
├── firStorageWrapper.test.ts
├── firUserWrapper.test.ts
├── logger.test.ts           # unit
└── retry.test.ts            # unit
```

- **Unit tests** run without any credentials.
- **Integration tests** hit a real Firebase project and **auto-skip** when
  credentials aren't provided.

## Providing credentials

Two ways:

```bash
# 1) env var
export FIREBASE_CREDENTIALS_PATH=/absolute/path/to/service-account.json
npm test

# 2) drop the file at credentials/credential-helper.json (gitignored)
mkdir -p credentials
cp /path/to/sa.json credentials/credential-helper.json
npm test
```

`.gitignore` already blocks `credentials/`, `*-firebase-adminsdk-*.json`,
`*serviceAccount*.json` and common variants — **do not disable these**.

## Service-account permissions

The service account needs the following roles for the full suite to pass:

| Suite                    | Minimum role(s)                                   |
|--------------------------|---------------------------------------------------|
| `firestoreWrapper.test`  | `Cloud Datastore User` (read/write) + owner-level for `listCollections` |
| `firStorageWrapper.test` | `Storage Admin` (or at least Object Admin on the default bucket) |
| `firUserWrapper.test`    | `Firebase Authentication Admin`                   |

If a suite lacks the needed role or the feature isn't enabled on the
project, the suite **auto-skips with a warning** — it doesn't fail the run.

## Feature prerequisites

- **Firestore** — always required; create the default database once in the
  Firebase Console if you haven't already.
- **Firebase Authentication** — enable it (any sign-in provider, or just
  leave "Email/Password" off — enabling Auth for the project is enough).
  Without this, `FirUserWrapper` tests auto-skip.
- **Cloud Storage** — Firebase Console → Storage → Get started. Without
  this, the default bucket doesn't exist and `FirStorageWrapper` tests
  auto-skip.

## Anatomy of an integration test

```ts
import { beforeAll, afterAll, describe, it } from 'vitest';
import { FirInstance, FirestoreWrapper } from '../src/index.js';
import { tryLoadCredentials, uniqueAppName } from './helpers/credentials.js';

const credentials = await tryLoadCredentials();
const describeIf = credentials ? describe : describe.skip;

describeIf('my suite', () => {
  let instance: FirInstance;
  let db: FirestoreWrapper;

  beforeAll(() => {
    instance = new FirInstance(credentials!, uniqueAppName('mytests'));
    db = new FirestoreWrapper(instance);
  });

  afterAll(async () => {
    await db.deleteCollection('mytests_scratch').catch(() => undefined);
    await instance.dispose();
  });

  it('...', async () => { /* ... */ });
});
```

Three key patterns:

1. **`describeIf`** — skips the whole suite if no credentials.
2. **`uniqueAppName`** — avoids "app already initialized" clashes when
   multiple test files run in the same process.
3. **`afterAll` cleanup** — delete any seeded data to keep the remote DB tidy.

## Running against a specific project

```bash
# Only run the Firestore suite
npx vitest run tests/firestoreWrapper.test.ts

# Filter by test name
npx vitest run -t "queryPage"
```

## Using the Firestore emulator

Not yet wired up in this repo (the integration suite is currently
credential-based). To run against the emulator in your own environment,
set `FIRESTORE_EMULATOR_HOST` before invoking any wrapper:

```bash
export FIRESTORE_EMULATOR_HOST=localhost:8080
```

`firebase-admin` picks this up automatically. Auth operations won't work
this way — the Auth emulator needs `FIREBASE_AUTH_EMULATOR_HOST` and the
service account still has to be valid (any real one works locally).
