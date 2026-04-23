# `FirStorageWrapper` — Cloud Storage reference

```ts
import { FirStorageWrapper } from 'firescore';
const storage = new FirStorageWrapper(instance);
```

The default bucket is `${project_id}.firebasestorage.app` unless you
override it via `FirInstance`'s `storageBucket` option.

## Uploads

### `uploadFile(localPath, remoteFileName, options?)`

```ts
await storage.uploadFile('/tmp/avatar.jpg', 'users/123/avatar.jpg', {
  contentType: 'image/jpeg',
});
```

**Auto-gzip:** disabled by default for common already-compressed media
(mp4, jpg, png, mp3, …). Force with `{ gzip: true }`.

**Custom metadata:**

```ts
await storage.uploadFile('/tmp/export.csv', 'exports/export.csv', {
  metadata: { owner: 'team-x', environment: 'prod' },
});
```

**Different bucket:**

```ts
await storage.uploadFile(localPath, remote, { bucketName: 'my-other-bucket' });
```

## Downloads

### `downloadFile(path, destination, bucketName?)`

Convenience wrapper over `File.download`. Good for small files.

### `downloadFileToLocalPath(bucketName, remote, localPath)`

Streams the file, awaiting stream completion via `pipeline`. Prefer this for
large payloads.

```ts
await storage.downloadFileToLocalPath(
  'my-bucket',
  'exports/huge.csv',
  '/tmp/huge.csv',
);
```

## Queries

### `listFiles(bucketName?, prefix?)`

```ts
const names = await storage.listFiles(undefined, 'users/123/');
```

### `fileExists(path, bucketName?)`

```ts
if (await storage.fileExists('users/123/avatar.jpg')) { /* ... */ }
```

## URLs

### `getPublicUrl(path, bucketName?)`

Canonical URL — does **not** check that the object is actually public.

### `generateSignedUrl(bucketName, path, expiresInMs?)`

Default validity: 1 hour.

```ts
const url = await storage.generateSignedUrl('my-bucket', 'photo.jpg', 5 * 60_000);
```

### `makeFilePublic(bucketName, path)`

Grants allUsers read and returns the public URL.

## Mutations

- `deleteFile(path, bucketName?)`
- `deleteFilesInBatch(bucketName, paths)` — parallel deletes
- `moveFile(src, dest, bucketName?)` — rename within bucket
- `copyFile(src, dest, bucketName?)`
- `updateFileMetadata(path, metadata, bucketName?)`

## Buckets

### `getBucket(bucketName?)`

Returns the `@google-cloud/storage` Bucket object — escape hatch for APIs
we don't expose directly.

### `createBucket(bucketName)`

```ts
const bucket = await storage.createBucket('new-firescore-bucket');
```

Requires appropriate IAM rights on the service account.

## Logging

`uploadFile` emits a `storage.upload.done` debug event with `{ bucket,
remoteFileName, gzip }`. See [Logging](./logging.md).
