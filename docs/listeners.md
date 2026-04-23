# Real-time listeners

`FirestoreWrapper` exposes two typed listener helpers on top of Firestore's
`onSnapshot`. Both return an `Unsubscribe` function — **always call it** when
you're done.

## `onDocumentSnapshot`

Subscribe to a single document.

```ts
const stop = db.onDocumentSnapshot<User>(
  'users/123',
  (user) => {
    if (!user) {
      console.log('User deleted');
      return;
    }
    console.log('User changed:', user.id, user.name);
  },
  (error) => {
    console.error('Listener error:', error);
  },
);

// Later — release the gRPC stream:
stop();
```

The handler receives `null` when the document is deleted or doesn't exist.

## `onCollectionSnapshot`

Subscribe to a collection (optionally filtered and ordered).

```ts
const stop = db.onCollectionSnapshot<Order>(
  'orders',
  (orders) => {
    console.log(`${orders.length} live orders`);
    renderUI(orders);
  },
  {
    filters: [{ field: 'status', op: '==', value: 'pending' }],
    orderBy: [{ field: 'createdAt', direction: 'desc' }],
    limit: 100,
    onError: (err) => logger.error(err.message),
  },
);
```

Every change in the underlying query triggers a full re-delivery of the
current result set — compute diffs yourself if needed.

## Lifecycle tips

- **Always store the `Unsubscribe`** and call it in your cleanup path. Each
  live listener holds an open gRPC stream.
- **Don't create listeners inside React renders / loops** without cleanup —
  you'll leak streams until the process exits.
- **Combine listeners with `AbortController`-like patterns:**

```ts
class UserWatcher {
  private stop?: () => void;

  start(uid: string) {
    this.stop = db.onDocumentSnapshot<User>(`users/${uid}`, (u) => this.onUser(u));
  }

  dispose() {
    this.stop?.();
    this.stop = undefined;
  }

  private onUser(_u: User | null) { /* ... */ }
}
```

- **Listeners don't retry** on `UNAVAILABLE` the way writes do — Firestore
  reconnects internally, but unrecoverable errors (e.g. `PERMISSION_DENIED`)
  land in `onError`. Log them.

## Testing listeners

A working pattern (also used in the repo's integration tests):

```ts
const received: Array<User | null> = [];
await new Promise<void>((resolve) => {
  const stop = db.onDocumentSnapshot<User>('users/123', (u) => {
    received.push(u);
    if (received.length === 2) { stop(); resolve(); }
  });
  // Trigger a change shortly after the first snapshot lands.
  setTimeout(() => db.updateFieldsInDocument('users/123', { age: 42 }), 400);
});
```
