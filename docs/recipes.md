# Recipes

Practical patterns that combine multiple firescore APIs.

## Mirror a document across projects

```ts
const prod    = new FirInstance(prodCreds, 'prod');
const staging = new FirInstance(stagingCreds, 'staging');

const prodDb    = new FirestoreWrapper(prod);
const stagingDb = new FirestoreWrapper(staging);

const doc = await prodDb.getDocument('users/abc');
await stagingDb.setDocument('users/abc', doc);
```

## Atomic counter increment with retry

```ts
await db.executeWithRetry(
  () => db.incrementField('metrics/daily', 'pageviews', 1),
  RetryPolicy.LONG,
);
```

## Transaction: transfer between accounts

```ts
await db.performTransaction(async (tx) => {
  const refA = db.getDocumentRef<Account>('accounts/A');
  const refB = db.getDocumentRef<Account>('accounts/B');

  const [a, b] = await Promise.all([tx.get(refA), tx.get(refB)]);
  const balA = a.data()!.balance;
  const balB = b.data()!.balance;

  if (balA < 30) throw new Error('Insufficient funds');

  tx.update(refA, { balance: balA - 30 });
  tx.update(refB, { balance: balB + 30 });
});
```

## Bulk import with per-call policy overrides

```ts
// Ingest 100k rows without updating timestamps, with long retries.
await db.setDocumentsInBatches(
  'imports/2026/users',
  payload,
  /* batches */ 200,
  'id',
  { addCreationTimestamp: false, addUpdateTimestamp: false },
);
```

## Export a large collection to disk

```ts
import fs from 'node:fs';

const out = fs.createWriteStream('users.ndjson');
try {
  await db.queryPaginate<User>('users', {
    orderBy: [{ field: 'createdAt', direction: 'asc' }],
    pageSize: 500,
    onDocument: (user) => {
      out.write(JSON.stringify(user) + '\n');
    },
  });
} finally {
  out.end();
}
```

## Paginated REST endpoint

```ts
app.get('/users', async (req, res) => {
  const afterId = typeof req.query.after === 'string' ? req.query.after : undefined;

  let cursor = null;
  if (afterId) {
    const snap = await db.firestore.doc(`users/${afterId}`).get();
    if (snap.exists) cursor = snap as QueryDocumentSnapshot;
  }

  const page = await db.queryPage<User>({
    collectionPath: 'users',
    orderBy: [{ field: 'createdAt', direction: 'asc' }],
    pageSize: 50,
    cursor,
  });

  res.json({
    items: page.docs,
    next: page.cursor ? page.docs[page.docs.length - 1].id : null,
  });
});
```

## Collection group export

```ts
const reviews = await db.collectionGroup<Review>('reviews');
console.log(`Found ${reviews.length} reviews across all posts`);
```

## Real-time mirroring

```ts
const stop = db.onCollectionSnapshot<Order>(
  'orders',
  async (orders) => {
    for (const order of orders) {
      await sinkDb.setDocument(`orders_mirror/${order.id}`, order);
    }
  },
  { filters: [{ field: 'status', op: '==', value: 'pending' }] },
);
// ... later:
stop();
```

## Cleanup helpers

```ts
// Wipe a test collection at the end of a run.
await db.deleteCollection('tests', /* pageSize */ 250);
```

## Upload with cache-control metadata

```ts
await storage.uploadFile('/tmp/public.png', 'public/logo.png', {
  contentType: 'image/png',
  metadata: {
    cacheControl: 'public, max-age=86400',
  },
});
```

## Structured logger for production

```ts
import pino from 'pino';
import type { Logger } from 'firescore';

const p = pino({ level: 'info' });
const logger: Logger = {
  debug: (m, c) => p.debug(c ?? {}, m),
  info:  (m, c) => p.info(c ?? {}, m),
  warn:  (m, c) => p.warn(c ?? {}, m),
  error: (m, c) => p.error(c ?? {}, m),
};

new FirInstance(creds, 'prod', { logger });
```

## Conditional retry for external calls

```ts
// Reuse the Firestore retry loop for a third-party API call.
const response = await db.executeWithRetry(async () => {
  const r = await fetch('https://external.example.com/data');
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`);
    // Mark 5xx as retryable:
    (err as { code?: string }).code = r.status >= 500 ? 'UNAVAILABLE' : 'INVALID_ARGUMENT';
    throw err;
  }
  return r.json();
}, RetryPolicy.LONG);
```
