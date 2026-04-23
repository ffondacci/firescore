# `FirestoreWrapper` — Firestore reference

Every method is typed. Generic helpers like `WithId<T>` ensure documents
carry their id at runtime too.

```ts
import { FirestoreWrapper } from 'firescore';
const db = new FirestoreWrapper(instance);
```

## Reading

### `getDocument<T>(path, policy?)`

Throws `DocumentNotFoundError` when missing.

```ts
const user = await db.getDocument<User>('users/123');
```

### `getMultipleDocuments<T>(paths)`

Parallel reads. Returns `null` for missing docs, keeping index alignment.

```ts
const docs = await db.getMultipleDocuments<User>([
  'users/1', 'users/2', 'users/3',
]);
docs.forEach((d, i) => console.log(i, d?.id, d?.name));
```

### `documentExists(path)`

```ts
if (await db.documentExists('users/123')) { /* ... */ }
```

### `getCollection<T>(path)`

Returns the entire collection — beware of size. For large collections prefer
[`queryPaginate`](./pagination.md).

```ts
const users = await db.getCollection<User>('users');
```

### `queryDocuments<T>(path, filters, orderBy?)`

```ts
const adults = await db.queryDocuments<User>(
  'users',
  [{ field: 'age', op: '>=', value: 18 }],
  [{ field: 'age', direction: 'desc' }],
);
```

### Collection groups

Match every collection (at any depth) whose id equals `collectionId`:

```ts
// Fetch every `reviews` document across all posts
const reviews = await db.collectionGroup<Review>(
  'reviews',
  [{ field: 'approved', op: '==', value: true }],
  [{ field: 'createdAt', direction: 'desc' }],
  100, // optional limit
);
```

> Collection-group queries with filters usually require a **composite index**.
> Firestore will throw `FAILED_PRECONDITION` with a link to auto-create one.

## Writing

### `setDocument<T>(path, data, policy?, storagePolicy?)`

Creates or replaces. Auto-applies storage policy timestamps.

```ts
await db.setDocument('users/123', { name: 'Jane', age: 30 });
```

### `updateDocument<T>(path, partial, policy?, storagePolicy?)`

Partial update; fails if the document does not exist.

```ts
await db.updateDocument<User>('users/123', { age: 31 });
```

### `updateFieldsInDocument<T>(path, partial)`

Like `updateDocument` but bypasses the storage policy (does not touch
`updatedAt`). Use when you must not change timestamps.

### `deleteDocument(path, policy?)`

```ts
await db.deleteDocument('users/123');
```

### `deleteFieldInDocument(path, fields)`

Removes specific fields from a document.

```ts
await db.deleteFieldInDocument('users/123', ['temporaryToken', 'oldField']);
```

### `incrementField(path, field, amount)`

Atomic increment (negative to decrement).

```ts
await db.incrementField('products/42', 'stock', -1);
```

### `addElementInDocumentArray(path, field, element)` / `removeElementInDocumentArray(path, field, element)`

Atomic array union / remove.

```ts
await db.addElementInDocumentArray('users/123', 'tags', 'premium');
await db.removeElementInDocumentArray('users/123', 'tags', 'trial');
```

## Auto-id push

### `pushDocument<T>(collectionPath, data, storagePolicy?)`

Creates a new document with a generated id; returns the id.

```ts
const id = await db.pushDocument<User>('users', { name: 'Jane', age: 30 });
```

### `pushDocumentAndSetKey<T>(collectionPath, data, docKey?, storagePolicy?)`

Same, then writes the generated id back into `docKey` (default `docId`).

```ts
const id = await db.pushDocumentAndSetKey<User>('users', { name: 'Jane' }, 'userId');
// Stored document: { userId: <id>, name: 'Jane', createdAt, updatedAt }
```

## Batches

All batch methods chunk automatically at Firestore's **500-operation** cap.

### `setDocumentsInBatches<T>(basePath, datas, batchNumber, docKey, storagePolicy?)`

Each entry's `docKey` field becomes the document id.

```ts
await db.setDocumentsInBatches('users', users, /*batches*/ 5, 'id');
```

### `batchUpdateDocuments<T>(updates, storagePolicy?)`

```ts
await db.batchUpdateDocuments<User>([
  { path: 'users/1', data: { active: false } },
  { path: 'users/2', data: { active: false } },
]);
```

### `batchDeleteDocuments(paths)`

```ts
await db.batchDeleteDocuments(['users/1', 'users/2', 'users/3']);
```

### `pushDocumentInBatches<T>(path, datas, batchNumber, storagePolicy?)`

Creates many docs with auto ids and returns them.

```ts
const ids = await db.pushDocumentInBatches('users', users, 5);
```

## Transactions

```ts
await db.performTransaction(async (tx) => {
  const refA = db.getDocumentRef('users/a');
  const refB = db.getDocumentRef('users/b');
  const [a, b] = await Promise.all([tx.get(refA), tx.get(refB)]);
  tx.update(refA, { balance: a.data()!.balance - 30 });
  tx.update(refB, { balance: b.data()!.balance + 30 });
});
```

## Collections

- `listRootCollections()` — top-level collections
- `listCollectionsUnderDocument(path)` — subcollections under a doc
- `deleteCollection(path, pageSize?)` — paginated wipe

## Pagination & listeners

Dedicated pages:

- [Pagination](./pagination.md) — `queryPage`, `queryPaginate`
- [Listeners](./listeners.md) — `onDocumentSnapshot`, `onCollectionSnapshot`

## Retry

All Firestore reads/writes go through `executeWithRetry`. Override per call
with the `policy` argument:

```ts
await db.getDocument('users/123', RetryPolicy.HUGE);
```

See [Retry policy](./retry-policy.md).
