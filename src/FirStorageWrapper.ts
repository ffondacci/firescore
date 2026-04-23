import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

import type { Bucket, File as GcsFile, PredefinedAcl } from '@google-cloud/storage';
import { getStorage } from 'firebase-admin/storage';

import type { FirInstance } from './FirInstance.js';
import { NoopLogger, type Logger } from './Logger.js';

/** Options for {@link FirStorageWrapper.uploadFile}. */
export interface UploadOptions {
  /** Force gzip. By default, disabled for common already-compressed media types. */
  gzip?: boolean;
  /** MIME content type (otherwise inferred by gcs). */
  contentType?: string;
  /** Predefined ACL (e.g. `'publicRead'`). */
  predefinedAcl?: PredefinedAcl;
  /** Custom metadata attached to the file. */
  metadata?: Record<string, unknown>;
  /** Target bucket. Defaults to the Firebase app default bucket. */
  bucketName?: string;
}

const MEDIA_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'm4v',
  'webm',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'heif',
  'mp3',
  'aac',
  'm4a',
  'ogg',
  'flac',
]);

/**
 * Cloud Storage wrapper built on top of `@google-cloud/storage` (the same
 * client `firebase-admin` uses internally).
 *
 * @example
 * ```ts
 * const storage = new FirStorageWrapper(instance);
 * await storage.uploadFile('/tmp/img.jpg', 'photos/img.jpg');
 * const url = await storage.generateSignedUrl('my-bucket', 'photos/img.jpg');
 * ```
 */
export class FirStorageWrapper {
  readonly firInstance: FirInstance;
  readonly defaultBucket: Bucket;
  readonly logger: Logger;

  constructor(firInstance: FirInstance) {
    this.firInstance = firInstance;
    this.defaultBucket = getStorage(firInstance.app).bucket();
    this.logger = firInstance.logger ?? NoopLogger;
  }

  /** Get a bucket by name, or the default one when omitted. */
  getBucket(bucketName?: string): Bucket {
    return bucketName
      ? getStorage(this.firInstance.app).bucket(bucketName)
      : this.defaultBucket;
  }

  /**
   * Uploads a local file to a bucket. gzip is auto-disabled for common media
   * extensions (mp4, jpg, png, …) unless explicitly requested.
   */
  async uploadFile(
    localPath: string,
    remoteFileName: string,
    options: UploadOptions = {},
  ): Promise<GcsFile> {
    const bucket = this.getBucket(options.bucketName);
    const ext = (localPath.split('.').pop() ?? '').toLowerCase();
    const shouldGzip = options.gzip ?? !MEDIA_EXTENSIONS.has(ext);

    const [file] = await bucket.upload(localPath, {
      destination: remoteFileName,
      gzip: shouldGzip,
      ...(options.contentType ? { contentType: options.contentType } : {}),
      ...(options.predefinedAcl ? { predefinedAcl: options.predefinedAcl } : {}),
      ...(options.metadata ? { metadata: { metadata: options.metadata } } : {}),
    });
    this.logger.debug('storage.upload.done', {
      bucket: bucket.name,
      remoteFileName,
      gzip: shouldGzip,
    });
    return file;
  }

  /** Deletes a single file. */
  async deleteFile(filePath: string, bucketName?: string): Promise<void> {
    await this.getBucket(bucketName).file(filePath).delete();
  }

  /** Lists files in a bucket, optionally filtered by prefix. */
  async listFiles(bucketName?: string, prefix?: string): Promise<string[]> {
    const [files] = await this.getBucket(bucketName).getFiles(prefix ? { prefix } : {});
    return files.map((file) => file.name);
  }

  /** Downloads a file to a local path. */
  async downloadFile(filePath: string, destination: string, bucketName?: string): Promise<void> {
    await this.getBucket(bucketName).file(filePath).download({ destination });
  }

  /**
   * Streams a remote file to a local path, awaiting stream completion.
   * Prefer this to {@link downloadFile} for very large payloads.
   */
  async downloadFileToLocalPath(
    bucketName: string,
    remoteFileName: string,
    localPath: string,
  ): Promise<void> {
    const file = this.getBucket(bucketName).file(remoteFileName);
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`File ${remoteFileName} does not exist in ${bucketName}`);
    }
    await pipeline(file.createReadStream(), fs.createWriteStream(localPath));
  }

  /** Returns the canonical public URL for a file (no permission check). */
  getPublicUrl(filePath: string, bucketName?: string): string {
    const name = bucketName ?? this.defaultBucket.name;
    return `https://storage.googleapis.com/${name}/${filePath}`;
  }

  /** Creates a new bucket owned by the Firebase project. */
  async createBucket(bucketName: string): Promise<Bucket> {
    const [bucket] = await getStorage(this.firInstance.app).bucket(bucketName).create();
    return bucket;
  }

  /** Sets metadata on a file. */
  async updateFileMetadata(
    filePath: string,
    metadata: Record<string, unknown>,
    bucketName?: string,
  ): Promise<void> {
    await this.getBucket(bucketName).file(filePath).setMetadata(metadata);
  }

  /** Returns `true` if the file exists in the bucket. */
  async fileExists(filePath: string, bucketName?: string): Promise<boolean> {
    const [exists] = await this.getBucket(bucketName).file(filePath).exists();
    return exists;
  }

  /** Moves (rename) a file within a bucket. */
  async moveFile(sourcePath: string, destinationPath: string, bucketName?: string): Promise<void> {
    await this.getBucket(bucketName).file(sourcePath).move(destinationPath);
  }

  /** Copies a file within a bucket. */
  async copyFile(sourcePath: string, destinationPath: string, bucketName?: string): Promise<void> {
    await this.getBucket(bucketName).file(sourcePath).copy(destinationPath);
  }

  /**
   * Generates a V2 read-only signed URL for a file.
   *
   * @param expiresInMs Validity from now, in milliseconds. Defaults to 1 hour.
   */
  async generateSignedUrl(
    bucketName: string,
    filePath: string,
    expiresInMs: number = 60 * 60 * 1000,
  ): Promise<string> {
    const [url] = await this.getBucket(bucketName).file(filePath).getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInMs,
    });
    return url;
  }

  /** Marks a file publicly readable and returns its public URL. */
  async makeFilePublic(bucketName: string, filePath: string): Promise<string> {
    await this.getBucket(bucketName).file(filePath).makePublic();
    return `https://storage.googleapis.com/${bucketName}/${filePath}`;
  }

  /** Deletes multiple files in parallel. */
  async deleteFilesInBatch(bucketName: string, filePaths: string[]): Promise<void> {
    const bucket = this.getBucket(bucketName);
    await Promise.all(filePaths.map((p) => bucket.file(p).delete()));
  }
}
