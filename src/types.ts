import type { WhereFilterOp } from 'firebase-admin/firestore';

/**
 * Controls automatic timestamping and pagination defaults for writes.
 * Applied by {@link FirestoreWrapper} on every set/update.
 */
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

/** Default storage policy — creation + update timestamps, 50 docs per page. */
export const DEFAULT_STORAGE_POLICY: StoragePolicy = {
  addCreationTimestamp: true,
  creationTimestampField: 'createdAt',
  addUpdateTimestamp: true,
  updateTimestampField: 'updatedAt',
  pageSize: 50,
};

/** Shape of a Google service-account JSON file. */
export interface ServiceAccountCredentials {
  project_id?: string;
  client_email?: string;
  private_key?: string;
  [key: string]: unknown;
}

/**
 * A single Firestore `where()` clause.
 *
 * @example
 * ```ts
 * const f: QueryFilter = { field: 'age', op: '>=', value: 18 };
 * ```
 */
export interface QueryFilter {
  field: string;
  op: WhereFilterOp;
  value: unknown;
}

/** A single `orderBy()` clause. */
export interface QueryOrderBy {
  field: string;
  direction?: 'asc' | 'desc';
}

export type DocumentData = Record<string, unknown>;

/** A single `update` operation to be applied in a batch. */
export interface BatchUpdate<T extends DocumentData = DocumentData> {
  path: string;
  data: Partial<T>;
}
