# Getting started

## Install

```bash
npm install firescore firebase-admin @google-cloud/storage
```

Requires Node.js ≥ 18. The package is ESM-only.

## Credentials

You need a Firebase service-account JSON. From the Firebase console:

> **Project settings → Service accounts → Generate new private key**

The resulting file looks like:

```json
{
  "type": "service_account",
  "project_id": "your-project",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com",
  "...": "..."
}
```

**Never commit this file.** The repo's `.gitignore` already blocks the most
common naming patterns.

## Your first instance

```ts
import { FirInstance, FirestoreWrapper } from 'firescore';
import serviceAccount from './credentials/service-account.json' with { type: 'json' };

const instance = new FirInstance(serviceAccount, serviceAccount.project_id!);
const db = new FirestoreWrapper(instance);

interface User { name: string; age: number }

const id = await db.pushDocument<User>('users', { name: 'Jane', age: 30 });
const user = await db.getDocument<User>(`users/${id}`);
console.log(user.name); // Jane
```

## Configuration

```ts
import { FirInstance, RetryPolicy, ConsoleLogger } from 'firescore';

const instance = new FirInstance(serviceAccount, 'prod', {
  // Retry policy for Firestore operations (defaults to RetryPolicy.SHORT)
  retryPolicy: RetryPolicy.LONG,

  // Optional storage bucket override (defaults to `${project_id}.firebasestorage.app`)
  storageBucket: 'custom-bucket.appspot.com',

  // Automatic timestamping + pagination defaults
  storagePolicy: {
    addCreationTimestamp: true,
    creationTimestampField: 'createdAt',
    addUpdateTimestamp: true,
    updateTimestampField: 'updatedAt',
    pageSize: 100,
  },

  // Optional logger — defaults to NoopLogger
  logger: new ConsoleLogger('info'),
});
```

See:
- [Retry policy](./retry-policy.md)
- [Storage policy](./storage-policy.md)
- [Logging](./logging.md)

## Multiple instances

A process can own any number of `FirInstance`s, each mapped to a different
Firebase project, with their own credentials and policies.

```ts
const prod = new FirInstance(prodCreds, 'prod', { retryPolicy: RetryPolicy.LONG });
const staging = new FirInstance(stagingCreds, 'staging');

const prodDb = new FirestoreWrapper(prod);
const stagingDb = new FirestoreWrapper(staging);

// Mirror a document from prod to staging
const user = await prodDb.getDocument('users/abc');
await stagingDb.setDocument('users/abc', user);
```

The `name` passed as the second argument to `FirInstance` becomes the internal
Firebase app name — it must be unique within the process.

## Cleanup

When shutting down (e.g. long-running scripts, tests), call `dispose()` to
release the Firebase app:

```ts
await instance.dispose();
```

## Next

- [Firestore reference](./firestore.md)
- [Recipes](./recipes.md)
- [Testing](./testing.md)
