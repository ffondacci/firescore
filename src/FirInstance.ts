import admin from 'firebase-admin';
import { deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import { RetryPolicy, type RetryPolicyOptions } from './RetryPolicy.js';
import {
  DEFAULT_STORAGE_POLICY,
  type ServiceAccountCredentials,
  type StoragePolicy,
  type StoragePolicyInput,
} from './types.js';

export interface FirInstanceOptions {
  /** Optional override for the storage bucket name. Defaults to `${project_id}.firebasestorage.app`. */
  storageBucket?: string;
  /** Retry policy for Firestore operations. Defaults to RetryPolicy.SHORT. */
  retryPolicy?: RetryPolicyOptions;
  /** Storage policy (timestamps, pagination, etc.). */
  storagePolicy?: StoragePolicyInput;
}

/**
 * Represents a named Firebase app instance. Multiple instances can coexist,
 * each with its own credentials, retry and storage policies.
 */
export class FirInstance {
  readonly name: string;
  readonly app: App;
  readonly firestore: Firestore;

  retryPolicy: RetryPolicyOptions;
  storagePolicy: StoragePolicy;

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
  }

  setRetryPolicy(policy: RetryPolicyOptions): void {
    this.retryPolicy = policy;
  }

  setStoragePolicy(policy: StoragePolicyInput): void {
    this.storagePolicy = { ...this.storagePolicy, ...policy };
  }

  /**
   * Releases the Firebase app and its underlying resources.
   */
  async dispose(): Promise<void> {
    await deleteApp(this.app);
  }
}
