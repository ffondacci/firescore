import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

import type { Bucket, File as GcsFile, PredefinedAcl } from '@google-cloud/storage';
import { getStorage } from 'firebase-admin/storage';

import type { FirInstance } from './FirInstance.js';

export interface UploadOptions {
  /** Force gzip on upload. Defaults to true except for common media extensions. */
  gzip?: boolean;
  /** Custom content type override. */
  contentType?: string;
  /** Set predefined ACL. */
  predefinedAcl?: PredefinedAcl;
  /** Additional metadata to attach. */
  metadata?: Record<string, unknown>;
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

export class FirStorageWrapper {
  readonly firInstance: FirInstance;
  readonly defaultBucket: Bucket;

  constructor(firInstance: FirInstance) {
    this.firInstance = firInstance;
    this.defaultBucket = getStorage(firInstance.app).bucket();
  }

  /** Get a bucket by name, or the default one when omitted. */
  getBucket(bucketName?: string): Bucket {
    return bucketName
      ? getStorage(this.firInstance.app).bucket(bucketName)
      : this.defaultBucket;
  }

  async uploadFile(
    localPath: string,
    remoteFileName: string,
    options: UploadOptions & { bucketName?: string } = {},
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
    return file;
  }

  async deleteFile(filePath: string, bucketName?: string): Promise<void> {
    await this.getBucket(bucketName).file(filePath).delete();
  }

  async listFiles(bucketName?: string, prefix?: string): Promise<string[]> {
    const [files] = await this.getBucket(bucketName).getFiles(prefix ? { prefix } : {});
    return files.map((file) => file.name);
  }

  async downloadFile(filePath: string, destination: string, bucketName?: string): Promise<void> {
    await this.getBucket(bucketName).file(filePath).download({ destination });
  }

  /**
   * Streams a remote file to a local path, awaiting stream completion.
   * Preferred over `downloadFile` for very large payloads.
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

  getPublicUrl(filePath: string, bucketName?: string): string {
    const name = bucketName ?? this.defaultBucket.name;
    return `https://storage.googleapis.com/${name}/${filePath}`;
  }

  async createBucket(bucketName: string): Promise<Bucket> {
    const [bucket] = await getStorage(this.firInstance.app).bucket(bucketName).create();
    return bucket;
  }

  async updateFileMetadata(
    filePath: string,
    metadata: Record<string, unknown>,
    bucketName?: string,
  ): Promise<void> {
    await this.getBucket(bucketName).file(filePath).setMetadata(metadata);
  }

  async fileExists(filePath: string, bucketName?: string): Promise<boolean> {
    const [exists] = await this.getBucket(bucketName).file(filePath).exists();
    return exists;
  }

  async moveFile(sourcePath: string, destinationPath: string, bucketName?: string): Promise<void> {
    await this.getBucket(bucketName).file(sourcePath).move(destinationPath);
  }

  async copyFile(sourcePath: string, destinationPath: string, bucketName?: string): Promise<void> {
    await this.getBucket(bucketName).file(sourcePath).copy(destinationPath);
  }

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

  async makeFilePublic(bucketName: string, filePath: string): Promise<string> {
    await this.getBucket(bucketName).file(filePath).makePublic();
    return `https://storage.googleapis.com/${bucketName}/${filePath}`;
  }

  async deleteFilesInBatch(bucketName: string, filePaths: string[]): Promise<void> {
    const bucket = this.getBucket(bucketName);
    await Promise.all(filePaths.map((p) => bucket.file(p).delete()));
  }
}
