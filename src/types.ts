import type { WhereFilterOp } from 'firebase-admin/firestore';

export interface StoragePolicy {
  /** If true, a creation timestamp field is set on new documents. */
  addCreationTimestamp: boolean;
  /** Field name for the creation timestamp. */
  creationTimestampField: string;
  /** If true, an update timestamp field is set on writes. */
  addUpdateTimestamp: boolean;
  /** Field name for the update timestamp. */
  updateTimestampField: string;
  /** Default page size for paginated queries. */
  pageSize: number;
}

export type StoragePolicyInput = Partial<StoragePolicy>;

export const DEFAULT_STORAGE_POLICY: StoragePolicy = {
  addCreationTimestamp: true,
  creationTimestampField: 'createdAt',
  addUpdateTimestamp: true,
  updateTimestampField: 'updatedAt',
  pageSize: 50,
};

export interface ServiceAccountCredentials {
  project_id?: string;
  client_email?: string;
  private_key?: string;
  [key: string]: unknown;
}

export interface QueryFilter {
  field: string;
  op: WhereFilterOp;
  value: unknown;
}

export interface QueryOrderBy {
  field: string;
  direction?: 'asc' | 'desc';
}

export type DocumentData = Record<string, unknown>;

export interface BatchUpdate<T extends DocumentData = DocumentData> {
  path: string;
  data: Partial<T>;
}
