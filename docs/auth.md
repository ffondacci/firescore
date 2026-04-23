# `FirUserWrapper` — Firebase Auth reference

Typed helpers over `firebase-admin/auth`. Requires Firebase
Authentication to be **enabled** on the project (Firebase Console → Build
→ Authentication → Get started).

```ts
import { FirUserWrapper } from 'firescore';
const users = new FirUserWrapper(instance);
```

## Lifecycle

### `createUser(properties)`

```ts
const record = await users.createUser({
  email: 'jane@example.com',
  password: 'sup3rS3cret',
  displayName: 'Jane',
});
```

### `deleteUser(uid)`

```ts
await users.deleteUser(uid);
```

### `disableUser(uid)` / `enableUser(uid)`

Toggles the `disabled` flag. A disabled account cannot sign in and its
ID tokens are rejected.

## Reads

### `getUserRecord(uid)`

Throws `auth/user-not-found` when missing.

### `getUserByEmail(email)` / `getUserByPhoneNumber(phoneNumber)`

### `checkUserExists(uid)` → `boolean`

Swallows `auth/user-not-found` — returns `false` instead of throwing.

### `listUsers(limit?, pageToken?)`

```ts
let page = await users.listUsers(1000);
for (const u of page.users) /* ... */;
while (page.pageToken) {
  page = await users.listUsers(1000, page.pageToken);
  for (const u of page.users) /* ... */;
}
```

## Updates

### `updateUser(uid, properties)`

Arbitrary update — see [admin SDK docs](https://firebase.google.com/docs/reference/admin/node/firebase-admin.auth.updaterequest)
for accepted fields.

### `setUserCustomClaims(uid, claims)`

Writes custom claims into the ID token. Use in Firestore security rules,
or in your server code after verifying the token.

```ts
await users.setUserCustomClaims(uid, { role: 'admin', tier: 2 });
```

Clients must refresh their ID token (or wait up to 1 hour) to pick up new
claims.

### `forceUserPasswordReset(uid)`

Revokes all refresh tokens, forcing sign-out on every device.

## Links & tokens

### `generateEmailVerificationLink(email)` → `string`

### `generatePasswordResetLink(email)` → `string`

These return the link — **you** are responsible for sending the email
(e.g. via SendGrid, Postmark, SES…).

### `createCustomToken(uid, developerClaims?)` → `string`

Mints a custom token a client SDK can use to sign in with
`signInWithCustomToken()`. Useful for SSO bridges and testing.

## Gotchas

- **Auth operations do not go through `executeWithRetry`.** The admin SDK
  retries a few things internally but doesn't expose a policy. If you need
  retries, wrap calls yourself:

  ```ts
  await db.executeWithRetry(() => users.getUserByEmail(email));
  ```

- **Creating users is rate-limited** by Firebase. For bulk imports see
  [Admin SDK import guide](https://firebase.google.com/docs/auth/admin/import-users).

- **Custom claims payload is capped at 1000 bytes.**
