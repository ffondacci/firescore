# Pagination

Two APIs, two mental models.

| API             | Who drives the loop? | Use when                                    |
|-----------------|----------------------|---------------------------------------------|
| `queryPage`     | **Caller**           | REST handlers, UIs, streaming to a consumer |
| `queryPaginate` | **Library**          | Batch jobs, exports, migrations             |

Both use [Firestore cursor pagination](https://firebase.google.com/docs/firestore/query-data/query-cursors)
under the hood (no expensive offsets).

## `queryPage` — cursor-based

Fetches a single page and returns the cursor needed to fetch the next one.

```ts
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

let cursor: QueryDocumentSnapshot | null = null;

do {
  const page = await db.queryPage<User>({
    collectionPath: 'users',
    filters: [{ field: 'active', op: '==', value: true }],
    orderBy: [{ field: 'createdAt', direction: 'asc' }],
    pageSize: 50,
    cursor,
  });

  await sendToClient(page.docs);
  cursor = page.cursor;
} while (cursor);
```

**Returns:**

```ts
interface QueryPageResult<T> {
  docs: Array<WithId<T>>;
  cursor: QueryDocumentSnapshot | null; // null when no more pages
  hasMore: boolean;
}
```

### REST endpoint pattern

Because the cursor is a Firestore object, you can't send it raw over HTTP.
Options:

- **Serialize the key fields** of the last doc (id + whatever you order by)
  and re-query for a fresh cursor snapshot on the next call.
- **Keep cursor in server memory** keyed by a session id (fast, but stateful).

Example using key fields:

```ts
// Server
app.get('/users', async (req) => {
  const afterId = req.query.after as string | undefined;
  let cursor: QueryDocumentSnapshot | null = null;
  if (afterId) {
    const snap = await db.firestore.doc(`users/${afterId}`).get();
    cursor = snap as QueryDocumentSnapshot;
  }
  const page = await db.queryPage<User>({
    collectionPath: 'users',
    orderBy: [{ field: 'createdAt', direction: 'asc' }],
    pageSize: 50,
    cursor,
  });
  return {
    items: page.docs,
    next: page.cursor ? page.docs[page.docs.length - 1].id : null,
  };
});
```

## `queryPaginate` — callback-based

Drains the entire collection; the library handles the loop.

```ts
await db.queryPaginate<User>('users', {
  filters: [{ field: 'active', op: '==', value: true }],
  orderBy: [{ field: 'createdAt', direction: 'asc' }],
  pageSize: 500,
  onDocument: async (user) => {
    await exportTo(user);
  },
  onComplete: async () => {
    await writer.close();
  },
});
```

**Options:**

```ts
interface PaginateOptions<T> {
  filters?: QueryFilter[];
  orderBy?: QueryOrderBy[];
  pageSize?: number;                    // defaults to storagePolicy.pageSize
  startAfterDoc?: DocumentSnapshot;     // resume from a previous cursor
  storagePolicy?: StoragePolicyInput;
  onDocument: (doc: WithId<T>) => void | Promise<void>;
  onComplete?: () => void | Promise<void>;
}
```

The handler is awaited per-doc — slow handlers slow the whole loop (by
design — use for back-pressure).

## Choosing between the two

- **Need pagination state you control?** → `queryPage` (HTTP endpoints, UI "next" button).
- **Need to process every matching doc in one go?** → `queryPaginate`.
- Internally both are cursor-based; neither scales poorly with depth.

## Logging

`queryPaginate` emits a `firestore.queryPaginate.page` debug entry per page
with `{ collectionPath, size, processed }`. Attach a
[`ConsoleLogger('debug')`](./logging.md) to observe it.
