import admin from 'firebase-admin';
import { deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import { NoopLogger, type Logger } from './Logger.js';
import { RetryPolicy, type RetryPolicyOptions } from './RetryPolicy.js';
import {
  DEFAULT_STORAGE_POLICY,
  type ServiceAccountCredentials,
  type StoragePolicy,
  type StoragePolicyInput,
} from './types.js';

/**
 * Configuration options for a {@link FirInstance}.
 */
export interface FirInstanceOptions {
  /** Override for the storage bucket. Defaults to `${project_id}.firebasestorage.app`. */
  storageBucket?: string;
  /** Retry policy for Firestore operations. Defaults to {@link RetryPolicy.SHORT}. */
  retryPolicy?: RetryPolicyOptions;
  /** Storage policy (timestamps, pagination, ...). */
  storagePolicy?: StoragePolicyInput;
  /** Logger used by wrappers. Defaults to a no-op logger. */
  logger?: Logger;
}

/**
 * Represents a named Firebase app instance. Multiple instances can coexist,
 * each with its own credentials, retry and storage policies.
 *
 * @example
 * ```ts
 * const prod = new FirInstance(prodCreds, 'prod', {
 *   retryPolicy: RetryPolicy.LONG,
 *   logger: new ConsoleLogger('info'),
 * });
 * const staging = new FirInstance(stagingCreds, 'staging');
 * ```
 */
export class FirInstance {
  readonly name: string;
  readonly app: App;
  readonly firestore: Firestore;

  retryPolicy: RetryPolicyOptions;
  storagePolicy: StoragePolicy;
  logger: Logger;

  constructor(
    credentials: ServiceAccountCredentials,
    name: string,
    options: FirInstanceOptions = {},
  ) {
    this.name = name;

    const storageBucket =
      options.storageBucket ??
      (credentials.project_id ? `${credentials.project_id}.firebasestorage.app` : undefined);

    this.app = admin.initializeApp(
      {
        credential: admin.credential.cert(credentials as admin.ServiceAccount),
        ...(storageBucket ? { storageBucket } : {}),
      },
      name,
    );

    this.firestore = getFirestore(this.app);
    this.retryPolicy = options.retryPolicy ?? RetryPolicy.SHORT;
    this.storagePolicy = { ...DEFAULT_STORAGE_POLICY, ...options.storagePolicy };
    this.logger = options.logger ?? NoopLogger;
  }

  /** Replaces the retry policy used by derived wrappers going forward. */
  setRetryPolicy(policy: RetryPolicyOptions): void {
    this.retryPolicy = policy;
  }

  /** Merges new values into the storage policy. */
  setStoragePolicy(policy: StoragePolicyInput): void {
    this.storagePolicy = { ...this.storagePolicy, ...policy };
  }

  /** Replaces the logger. */
  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  /**
   * Releases the Firebase app and its underlying resources. Call when
   * shutting down a process that owns this instance.
   */
  async dispose(): Promise<void> {
    await deleteApp(this.app);
  }
}
