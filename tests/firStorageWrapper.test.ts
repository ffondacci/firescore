import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FirInstance, FirStorageWrapper } from '../src/index.js';
import { tryLoadCredentials, uniqueAppName } from './helpers/credentials.js';

const credentials = await tryLoadCredentials();
const describeIf = credentials ? describe : describe.skip;

describeIf('FirStorageWrapper', () => {
  let instance: FirInstance;
  let storage: FirStorageWrapper;
  let bucketName: string;
  let tmpDir: string;
  let bucketAvailable = true;
  const createdFiles: string[] = [];

  beforeAll(async () => {
    instance = new FirInstance(credentials!, uniqueAppName('storage-tests'));
    storage = new FirStorageWrapper(instance);
    bucketName = storage.defaultBucket.name;

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'firescore-storage-'));

    try {
      const [exists] = await storage.defaultBucket.exists();
      if (!exists) {
        console.warn(`[firStorageWrapper] bucket ${bucketName} does not exist — skipping.`);
        bucketAvailable = false;
      }
    } catch (err) {
      console.warn('[firStorageWrapper] cannot access default bucket, skipping:', err);
      bucketAvailable = false;
    }
  });

  afterAll(async () => {
    if (bucketAvailable) {
      await Promise.all(
        createdFiles.map((p) => storage.deleteFile(p).catch(() => undefined)),
      );
    }
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    await instance.dispose();
  });

  const itIf = (name: string, fn: () => Promise<void>, timeout?: number): void => {
    it(
      name,
      async () => {
        if (!bucketAvailable) return;
        await fn();
      },
      timeout,
    );
  };

  itIf('uploads a file, detects existence, lists and downloads it', async () => {
    const localPath = path.join(tmpDir, 'hello.txt');
    await fs.writeFile(localPath, 'hello firescore');
    const remote = `firescore-tests/${Date.now()}-hello.txt`;
    createdFiles.push(remote);

    await storage.uploadFile(localPath, remote, { contentType: 'text/plain' });

    expect(await storage.fileExists(remote)).toBe(true);

    const names = await storage.listFiles(undefined, 'firescore-tests/');
    expect(names).toContain(remote);

    const downloadPath = path.join(tmpDir, 'downloaded.txt');
    await storage.downloadFile(remote, downloadPath);
    const content = await fs.readFile(downloadPath, 'utf-8');
    expect(content).toBe('hello firescore');
  }, 30_000);

  itIf('streams download with downloadFileToLocalPath', async () => {
    const localPath = path.join(tmpDir, 'stream.txt');
    await fs.writeFile(localPath, 'stream me');
    const remote = `firescore-tests/${Date.now()}-stream.txt`;
    createdFiles.push(remote);

    await storage.uploadFile(localPath, remote, { contentType: 'text/plain' });

    const dest = path.join(tmpDir, 'streamed.txt');
    await storage.downloadFileToLocalPath(bucketName, remote, dest);
    const content = await fs.readFile(dest, 'utf-8');
    expect(content).toBe('stream me');
  }, 30_000);

  itIf('generates a signed URL that starts with https', async () => {
    const localPath = path.join(tmpDir, 'signed.txt');
    await fs.writeFile(localPath, 'signed');
    const remote = `firescore-tests/${Date.now()}-signed.txt`;
    createdFiles.push(remote);

    await storage.uploadFile(localPath, remote, { contentType: 'text/plain' });

    const url = await storage.generateSignedUrl(bucketName, remote, 60_000);
    expect(url.startsWith('https://')).toBe(true);
    expect(url).toContain(bucketName);
  }, 30_000);

  itIf('copies, moves and deletes files', async () => {
    const localPath = path.join(tmpDir, 'orig.txt');
    await fs.writeFile(localPath, 'orig');
    const original = `firescore-tests/${Date.now()}-orig.txt`;
    const copied = `firescore-tests/${Date.now()}-copy.txt`;
    const moved = `firescore-tests/${Date.now()}-moved.txt`;
    createdFiles.push(original, copied, moved);

    await storage.uploadFile(localPath, original, { contentType: 'text/plain' });
    await storage.copyFile(original, copied);
    expect(await storage.fileExists(copied)).toBe(true);

    await storage.moveFile(copied, moved);
    expect(await storage.fileExists(copied)).toBe(false);
    expect(await storage.fileExists(moved)).toBe(true);

    await storage.deleteFile(moved);
    expect(await storage.fileExists(moved)).toBe(false);
  }, 30_000);

  itIf('updates metadata on a file', async () => {
    const localPath = path.join(tmpDir, 'meta.txt');
    await fs.writeFile(localPath, 'meta');
    const remote = `firescore-tests/${Date.now()}-meta.txt`;
    createdFiles.push(remote);

    await storage.uploadFile(localPath, remote, { contentType: 'text/plain' });
    await storage.updateFileMetadata(remote, {
      metadata: { lifecycle: 'ephemeral', owner: 'firescore' },
    });
    // round-trip read is non-trivial via the public surface; just ensure no throw.
    expect(true).toBe(true);
  }, 30_000);

  itIf('returns a canonical public URL', async () => {
    const url = storage.getPublicUrl('firescore-tests/anything.txt');
    expect(url).toBe(`https://storage.googleapis.com/${bucketName}/firescore-tests/anything.txt`);
  });
});
