# Storage policy

Not to be confused with Cloud **Storage** — this is the **Firestore write
policy** that controls automatic timestamps and default pagination size.

## Defaults

```ts
{
  addCreationTimestamp: true,
  creationTimestampField: 'createdAt',
  addUpdateTimestamp: true,
  updateTimestampField: 'updatedAt',
  pageSize: 50,
}
```

## Set on the instance

```ts
new FirInstance(creds, 'prod', {
  storagePolicy: {
    creationTimestampField: 'created_at',
    updateTimestampField: 'updated_at',
    pageSize: 200,
  },
});
```

All fields are optional — omitted keys fall back to defaults.

## Override per call

Every write method accepts a `storagePolicy` override:

```ts
await db.setDocument(
  'migrations/xxx',
  payload,
  undefined,             // retry policy
  { addUpdateTimestamp: false }, // skip updatedAt for this one write
);
```

## Opt-out entirely

```ts
const migrate = new FirInstance(creds, 'migrate', {
  storagePolicy: {
    addCreationTimestamp: false,
    addUpdateTimestamp: false,
  },
});
```

Use this for data migrations where you want imported docs to keep their
original timestamps untouched.

## How it works

`FirestoreWrapper.applyStoragePolicy` runs right before `set` / `update`
calls. New documents (via `setDocument`, `pushDocument*`,
`setDocumentsInBatches`) are considered "new" — they receive both
`createdAt` and `updatedAt`. Updates (via `updateDocument`,
`batchUpdateDocuments`) only receive `updatedAt`.

`updateFieldsInDocument` is the **escape hatch**: it never applies the
storage policy. Use it when you explicitly must not touch timestamps.

## Pagination default

`pageSize` is used as the default when calling `queryPage` or
`queryPaginate` without an explicit size:

```ts
new FirInstance(creds, 'prod', { storagePolicy: { pageSize: 500 } });

// Uses 500 because no pageSize is given:
await db.queryPaginate('users', { onDocument: /* ... */ });
```
