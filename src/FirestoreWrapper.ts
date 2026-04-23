import retry from 'async-retry';
import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type Transaction,
  type WriteBatch,
} from 'firebase-admin/firestore';

import type { FirInstance } from './FirInstance.js';
import { NoopLogger, type Logger } from './Logger.js';
import type { RetryPolicyOptions } from './RetryPolicy.js';
import { isRetryableError } from './RetryableErrors.js';
import type {
  BatchUpdate,
  DocumentData,
  QueryFilter,
  QueryOrderBy,
  StoragePolicy,
  StoragePolicyInput,
} from './types.js';

/**
 * Thrown by {@link FirestoreWrapper.getDocument} when the requested
 * document does not exist. `code === 'DOCUMENT_NOT_FOUND'`.
 */
export class DocumentNotFoundError extends Error {
  readonly code = 'DOCUMENT_NOT_FOUND';
  constructor(public readonly path: string) {
    super(`Document not found: ${path}`);
    this.name = 'DocumentNotFoundError';
  }
}

/** Document payload with its document id lifted to `.id`. */
export type WithId<T extends DocumentData> = T & { id: string };

export type PaginateHandler<T extends DocumentData> = (doc: WithId<T>) => void | Promise<void>;
export type PaginateCompleteHandler = () => void | Promise<void>;

/** Options for {@link FirestoreWrapper.queryPaginate}. */
export interface PaginateOptions<T extends DocumentData> {
  filters?: QueryFilter[];
  orderBy?: QueryOrderBy[];
  pageSize?: number;
  startAfterDoc?: DocumentSnapshot;
  storagePolicy?: StoragePolicyInput;
  onDocument: PaginateHandler<T>;
  onComplete?: PaginateCompleteHandler;
}

/** Options for {@link FirestoreWrapper.queryPage}. */
export interface QueryPageOptions {
  collectionPath: string;
  filters?: QueryFilter[];
  orderBy?: QueryOrderBy[];
  pageSize?: number;
  /** Previous page's cursor (the `cursor` field returned by the previous call). */
  cursor?: QueryDocumentSnapshot | null;
}

/** Result of {@link FirestoreWrapper.queryPage}. */
export interface QueryPageResult<T extends DocumentData> {
  docs: Array<WithId<T>>;
  /** Snapshot of the last document in the page — pass back as `cursor` to fetch the next page. */
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
}

/** Callback invoked when a listener rejects. */
export type SnapshotErrorHandler = (error: Error) => void;

/** Returned by `onXxxSnapshot`. Invoke to stop listening. */
export type Unsubscribe = () => void;

/**
 * Strongly-typed Firestore wrapper with retry, storage policies and
 * a logger. Built on top of {@link FirInstance}.
 *
 * @example
 * ```ts
 * const db = new FirestoreWrapper(instance);
 *
 * interface User { name: string; age: number }
 *
 * const id = await db.pushDocument<User>('users', { name: 'Jane', age: 30 });
 * const user = await db.getDocument<User>(`users/${id}`);
 * ```
 */
export class FirestoreWrapper {
  readonly firestore: Firestore;
  readonly logger: Logger;
  retryPolicy: RetryPolicyOptions;
  storagePolicy: StoragePolicy;

  /** Firestore batches are capped at 500 operations — we chunk automatically. */
  static readonly MAX_BATCH_SIZE = 500;

  constructor(firInstance: FirInstance) {
    this.firestore = firInstance.firestore;
    this.retryPolicy = firInstance.retryPolicy;
    this.storagePolicy = firInstance.storagePolicy;
    this.logger = firInstance.logger ?? NoopLogger;
  }

  // ---------- Retry ----------

  /**
   * Executes an async function with the configured retry policy. Non-retryable
   * errors short-circuit immediately (no retry attempt).
   *
   * @param fn The async function to run.
   * @param policy Optional policy override for this call.
   *
   * @example
   * ```ts
   * const data = await db.executeWithRetry(
   *   () => someGrpcCall(),
   *   { retries: 5, minTimeout: 200, factor: 2 },
   * );
   * ```
   */
  async executeWithRetry<T>(fn: () => Promise<T>, policy?: RetryPolicyOptions): Promise<T> {
    const retryConfig = policy ?? this.retryPolicy;
    return retry<T>(async (bail, attempt) => {
      try {
        const result = await fn();
        if (attempt > 1) {
          this.logger.info('firestore.retry.succeeded', { attempt });
        }
        return result;
      } catch (error) {
        if (!isRetryableError(error)) {
          this.logger.warn('firestore.retry.bail', {
            attempt,
            code: (error as { code?: unknown } | null)?.code ?? 'unknown',
            message: error instanceof Error ? error.message : String(error),
          });
          bail(error instanceof Error ? error : new Error(String(error)));
          return undefined as never;
        }
        this.logger.warn('firestore.retry.attempt', {
          attempt,
          code: (error as { code?: unknown }).code ?? 'unknown',
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }, retryConfig);
  }

  protected applyStoragePolicy<T extends DocumentData>(
    data: T,
    isNew: boolean,
    policy: StoragePolicy,
  ): T {
    const now = FieldValue.serverTimestamp();
    const out: DocumentData = { ...data };
    if (isNew && policy.addCreationTimestamp) {
      out[policy.creationTimestampField] = now;
    }
    if (policy.addUpdateTimestamp) {
      out[policy.updateTimestampField] = now;
    }
    return out as T;
  }

  private resolvePolicy(override?: StoragePolicyInput): StoragePolicy {
    return override ? { ...this.storagePolicy, ...override } : this.storagePolicy;
  }

  // ---------- Document refs ----------

  /** Get a typed {@link DocumentReference}. */
  getDocumentRef<T extends DocumentData = DocumentData>(path: string): DocumentReference<T> {
    return this.firestore.doc(path) as DocumentReference<T>;
  }

  // ---------- Reads ----------

  /**
   * Retrieves a document. Throws {@link DocumentNotFoundError} if missing.
   *
   * @example
   * ```ts
   * const user = await db.getDocument<User>('users/123');
   * ```
   */
  async getDocument<T extends DocumentData = DocumentData>(
    path: string,
    policy?: RetryPolicyOptions,
  ): Promise<T> {
    return this.executeWithRetry(async () => {
      const snap = await this.getDocumentRef<T>(path).get();
      if (!snap.exists) throw new DocumentNotFoundError(path);
      return snap.data() as T;
    }, policy);
  }

  /**
   * Retrieves multiple documents in parallel. Returns `null` for each missing doc.
   */
  async getMultipleDocuments<T extends DocumentData = DocumentData>(
    docPaths: string[],
  ): Promise<Array<WithId<T> | null>> {
    const snapshots = await Promise.all(docPaths.map((p) => this.firestore.doc(p).get()));
    return snapshots.map((doc) =>
      doc.exists ? ({ id: doc.id, ...(doc.data() as T) } as WithId<T>) : null,
    );
  }

  /** Returns `true` if a document exists at the given path. */
  async documentExists(docPath: string): Promise<boolean> {
    const doc = await this.firestore.doc(docPath).get();
    return doc.exists;
  }

  // ---------- Writes ----------

  /**
   * Creates or replaces a document at the given path. Automatically adds
   * `createdAt` / `updatedAt` according to the storage policy.
   *
   * @example
   * ```ts
   * await db.setDocument('users/123', { name: 'Jane', age: 30 });
   * ```
   */
  async setDocument<T extends DocumentData>(
    path: string,
    data: T,
    policy?: RetryPolicyOptions,
    storagePolicy?: StoragePolicyInput,
  ): Promise<void> {
    const effective = this.resolvePolicy(storagePolicy);
    const payload = this.applyStoragePolicy(data, true, effective);
    return this.executeWithRetry(async () => {
      await this.getDocumentRef(path).set(payload);
    }, policy);
  }

  /**
   * Partially updates a document. Fails if the document does not exist.
   *
   * @example
   * ```ts
   * await db.updateDocument<User>('users/123', { age: 31 });
   * ```
   */
  async updateDocument<T extends DocumentData>(
    path: string,
    data: Partial<T>,
    policy?: RetryPolicyOptions,
    storagePolicy?: StoragePolicyInput,
  ): Promise<void> {
    const effective = this.resolvePolicy(storagePolicy);
    const payload = this.applyStoragePolicy(data as DocumentData, false, effective);
    return this.executeWithRetry(async () => {
      await this.getDocumentRef(path).update(payload);
    }, policy);
  }

  /** Deletes a document. Does not raise if already missing. */
  async deleteDocument(path: string, policy?: RetryPolicyOptions): Promise<void> {
    return this.executeWithRetry(async () => {
      await this.getDocumentRef(path).delete();
    }, policy);
  }

  /**
   * Updates specific fields without running the storage policy (no auto
   * timestamp). Useful when timestamps must not change.
   */
  async updateFieldsInDocument<T extends DocumentData>(
    docPath: string,
    data: Partial<T>,
  ): Promise<void> {
    await this.firestore.doc(docPath).update(data as DocumentData);
  }

  /** Deletes the listed fields from the document. */
  async deleteFieldInDocument(docPath: string, fields: string[]): Promise<void> {
    const updateData: DocumentData = {};
    for (const field of fields) {
      updateData[field] = FieldValue.delete();
    }
    await this.firestore.doc(docPath).update(updateData);
  }

  /** Atomically increments a numeric field (use negative `amount` to decrement). */
  async incrementField(docPath: string, field: string, amount: number): Promise<void> {
    await this.firestore.doc(docPath).update({ [field]: FieldValue.increment(amount) });
  }

  /** Atomically adds an element to an array field. Duplicates are ignored. */
  async addElementInDocumentArray(
    docPath: string,
    arrayId: string,
    element: unknown,
  ): Promise<void> {
    await this.firestore.doc(docPath).update({
      [arrayId]: FieldValue.arrayUnion(element),
    });
  }

  /** Atomically removes an element from an array field. */
  async removeElementInDocumentArray(
    docPath: string,
    arrayId: string,
    elementToRemove: unknown,
  ): Promise<void> {
    await this.firestore.doc(docPath).update({
      [arrayId]: FieldValue.arrayRemove(elementToRemove),
    });
  }

  // ---------- Collection operations ----------

  /** Retrieves every document of a collection as an array. Beware of size. */
  async getCollection<T extends DocumentData = DocumentData>(
    collectionPath: string,
  ): Promise<Array<WithId<T>>> {
    const snapshot = await this.firestore.collection(collectionPath).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as T) }) as WithId<T>);
  }

  /** Lists top-level collections of the Firestore database. */
  async listRootCollections(): Promise<string[]> {
    const collections = await this.firestore.listCollections();
    return collections.map((col) => col.id);
  }

  /** Lists sub-collections under a given document. */
  async listCollectionsUnderDocument(documentPath: string): Promise<string[]> {
    const collections = await this.firestore.doc(documentPath).listCollections();
    return collections.map((col) => col.id);
  }

  /**
   * Runs a filtered query on a collection and returns all matching documents.
   *
   * @example
   * ```ts
   * const adults = await db.queryDocuments<User>('users',
   *   [{ field: 'age', op: '>=', value: 18 }],
   *   [{ field: 'age', direction: 'desc' }],
   * );
   * ```
   */
  async queryDocuments<T extends DocumentData = DocumentData>(
    collectionPath: string,
    filters: QueryFilter[],
    orderBy: QueryOrderBy[] = [],
  ): Promise<Array<WithId<T>>> {
    let query: Query = this.firestore.collection(collectionPath);
    for (const f of filters) query = query.where(f.field, f.op, f.value);
    for (const o of orderBy) query = query.orderBy(o.field, o.direction ?? 'asc');
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as T) }) as WithId<T>);
  }

  /**
   * Runs a collection-group query: matches every collection (at any depth)
   * whose id is `collectionId`.
   *
   * @example
   * ```ts
   * // Get every "comments" document across all posts:
   * const recent = await db.collectionGroup<Comment>(
   *   'comments',
   *   [{ field: 'approved', op: '==', value: true }],
   *   [{ field: 'createdAt', direction: 'desc' }],
   * );
   * ```
   */
  async collectionGroup<T extends DocumentData = DocumentData>(
    collectionId: string,
    filters: QueryFilter[] = [],
    orderBy: QueryOrderBy[] = [],
    limit?: number,
  ): Promise<Array<WithId<T>>> {
    let query: Query = this.firestore.collectionGroup(collectionId);
    for (const f of filters) query = query.where(f.field, f.op, f.value);
    for (const o of orderBy) query = query.orderBy(o.field, o.direction ?? 'asc');
    if (limit !== undefined) query = query.limit(limit);
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as T) }) as WithId<T>);
  }

  /**
   * Reads ONE page of documents and returns a cursor to read the next one.
   * Prefer this over {@link queryPaginate} when the caller controls the
   * iteration loop (e.g. a REST endpoint, a UI, ...).
   *
   * @example
   * ```ts
   * let cursor: QueryDocumentSnapshot | null = null;
   * do {
   *   const page = await db.queryPage<User>({
   *     collectionPath: 'users',
   *     filters: [{ field: 'active', op: '==', value: true }],
   *     orderBy: [{ field: 'createdAt', direction: 'asc' }],
   *     pageSize: 100,
   *     cursor,
   *   });
   *   await processBatch(page.docs);
   *   cursor = page.cursor;
   * } while (cursor && page.hasMore);
   * ```
   */
  async queryPage<T extends DocumentData = DocumentData>(
    options: QueryPageOptions,
  ): Promise<QueryPageResult<T>> {
    const pageSize = options.pageSize ?? this.storagePolicy.pageSize;
    let query: Query = this.firestore.collection(options.collectionPath);
    for (const f of options.filters ?? []) query = query.where(f.field, f.op, f.value);
    for (const o of options.orderBy ?? []) query = query.orderBy(o.field, o.direction ?? 'asc');
    query = query.limit(pageSize);
    if (options.cursor) query = query.startAfter(options.cursor);

    const snapshot = await query.get();

    const docs = snapshot.docs.map(
      (doc) => ({ id: doc.id, ...(doc.data() as T) }) as WithId<T>,
    );
    const lastDoc = snapshot.docs[snapshot.docs.length - 1] ?? null;
    const hasMore = snapshot.size === pageSize;

    return { docs, cursor: hasMore ? lastDoc : null, hasMore };
  }

  /**
   * Iterates a collection with cursor pagination. Calls `onDocument` for each
   * doc and `onComplete` when exhausted.
   *
   * @example
   * ```ts
   * await db.queryPaginate<User>('users', {
   *   filters: [{ field: 'active', op: '==', value: true }],
   *   pageSize: 200,
   *   onDocument: async (user) => sink.push(user),
   *   onComplete: () => sink.close(),
   * });
   * ```
   */
  async queryPaginate<T extends DocumentData = DocumentData>(
    collectionPath: string,
    options: PaginateOptions<T>,
  ): Promise<void> {
    const effectivePolicy = this.resolvePolicy(options.storagePolicy);
    const pageSize = options.pageSize ?? effectivePolicy.pageSize;

    let cursor: DocumentSnapshot | undefined = options.startAfterDoc;
    let processed = 0;

    while (true) {
      let query: Query = this.firestore.collection(collectionPath);
      for (const f of options.filters ?? []) query = query.where(f.field, f.op, f.value);
      for (const o of options.orderBy ?? []) query = query.orderBy(o.field, o.direction ?? 'asc');
      query = query.limit(pageSize);
      if (cursor) query = query.startAfter(cursor);

      const snapshot = await query.get();

      if (snapshot.empty) break;

      for (const doc of snapshot.docs) {
        const data: WithId<T> = { id: doc.id, ...(doc.data() as T) } as WithId<T>;
        await options.onDocument(data);
        processed += 1;
      }

      this.logger.debug('firestore.queryPaginate.page', {
        collectionPath,
        size: snapshot.size,
        processed,
      });

      if (snapshot.size < pageSize) break;
      cursor = snapshot.docs[snapshot.docs.length - 1];
    }

    if (options.onComplete) await options.onComplete();
  }

  /** Deletes every document of a collection. Iterates in chunks to stay safe. */
  async deleteCollection(collectionPath: string, pageSize = 250): Promise<void> {
    const collection = this.firestore.collection(collectionPath);
    while (true) {
      const snapshot = await collection.limit(pageSize).get();
      if (snapshot.empty) break;
      const batch = this.firestore.batch();
      for (const doc of snapshot.docs) batch.delete(doc.ref);
      await batch.commit();
      if (snapshot.size < pageSize) break;
    }
  }

  // ---------- Bulk writes ----------

  /**
   * Writes an array of documents under `basePath`, using each object's
   * `docKey` field as the document id.
   *
   * @param basePath Parent collection path.
   * @param datas Data objects; each must carry a non-empty `docKey` field.
   * @param batchNumber Logical number of batches to split into — actual
   *   batches are always <= {@link FirestoreWrapper.MAX_BATCH_SIZE}.
   * @param docKey Field name whose value becomes the document id.
   */
  async setDocumentsInBatches<T extends DocumentData>(
    basePath: string,
    datas: T[],
    batchNumber: number,
    docKey: keyof T & string,
    storagePolicy?: StoragePolicyInput,
  ): Promise<void> {
    const effective = this.resolvePolicy(storagePolicy);
    const batchSize = Math.min(
      Math.ceil(datas.length / Math.max(batchNumber, 1)),
      FirestoreWrapper.MAX_BATCH_SIZE,
    );

    for (let i = 0; i < datas.length; i += batchSize) {
      const chunk = datas.slice(i, i + batchSize);
      const firestoreBatch = this.firestore.batch();
      for (const raw of chunk) {
        const key = raw[docKey];
        if (key === undefined || key === null || key === '') {
          throw new Error(`Missing document key "${docKey}" on one of the entries`);
        }
        const data = this.applyStoragePolicy(raw, true, effective);
        const docRef = this.firestore.doc(`${basePath}/${String(key)}`);
        firestoreBatch.set(docRef, data);
      }
      await firestoreBatch.commit();
      this.logger.debug('firestore.batch.set.committed', {
        basePath,
        size: chunk.length,
      });
    }
  }

  /**
   * Updates multiple documents in a batch. Chunks at 500 operations.
   *
   * @example
   * ```ts
   * await db.batchUpdateDocuments([
   *   { path: 'users/1', data: { active: false } },
   *   { path: 'users/2', data: { active: false } },
   * ]);
   * ```
   */
  async batchUpdateDocuments<T extends DocumentData = DocumentData>(
    updates: Array<BatchUpdate<T>>,
    storagePolicy?: StoragePolicyInput,
  ): Promise<void> {
    const effective = this.resolvePolicy(storagePolicy);
    for (let i = 0; i < updates.length; i += FirestoreWrapper.MAX_BATCH_SIZE) {
      const chunk = updates.slice(i, i + FirestoreWrapper.MAX_BATCH_SIZE);
      const batch: WriteBatch = this.firestore.batch();
      for (const u of chunk) {
        const docRef = this.firestore.doc(u.path);
        const data = this.applyStoragePolicy(u.data as DocumentData, false, effective);
        batch.update(docRef, data);
      }
      await batch.commit();
      this.logger.debug('firestore.batch.update.committed', { size: chunk.length });
    }
  }

  /** Deletes multiple documents in a batch. Chunks at 500 operations. */
  async batchDeleteDocuments(docPaths: string[]): Promise<void> {
    for (let i = 0; i < docPaths.length; i += FirestoreWrapper.MAX_BATCH_SIZE) {
      const chunk = docPaths.slice(i, i + FirestoreWrapper.MAX_BATCH_SIZE);
      const batch = this.firestore.batch();
      for (const p of chunk) batch.delete(this.firestore.doc(p));
      await batch.commit();
      this.logger.debug('firestore.batch.delete.committed', { size: chunk.length });
    }
  }

  // ---------- Pushes (auto-id) ----------

  /** Pushes a new document with an auto-generated id and returns that id. */
  async pushDocument<T extends DocumentData>(
    collectionPath: string,
    data: T,
    storagePolicy?: StoragePolicyInput,
  ): Promise<string> {
    const effective = this.resolvePolicy(storagePolicy);
    const payload = this.applyStoragePolicy(data, true, effective);
    const docRef = await this.firestore.collection(collectionPath).add(payload);
    return docRef.id;
  }

  /** Pushes a new document and writes its auto id back into `docKey` (default `docId`). */
  async pushDocumentAndSetKey<T extends DocumentData>(
    collectionPath: string,
    data: T,
    docKey = 'docId',
    storagePolicy?: StoragePolicyInput,
  ): Promise<string> {
    const effective = this.resolvePolicy(storagePolicy);
    const payload = this.applyStoragePolicy(data, true, effective);
    const docRef = await this.firestore.collection(collectionPath).add(payload);
    await docRef.update({ [docKey]: docRef.id });
    return docRef.id;
  }

  /** Pushes multiple documents with auto ids in batches. Returns their generated ids. */
  async pushDocumentInBatches<T extends DocumentData>(
    collectionPath: string,
    datas: T[],
    batchNumber: number,
    storagePolicy?: StoragePolicyInput,
  ): Promise<string[]> {
    if (!Array.isArray(datas)) throw new TypeError("Expected 'datas' to be an array");
    const effective = this.resolvePolicy(storagePolicy);
    const batchSize = Math.min(
      Math.ceil(datas.length / Math.max(batchNumber, 1)),
      FirestoreWrapper.MAX_BATCH_SIZE,
    );
    const ids: string[] = [];

    for (let i = 0; i < datas.length; i += batchSize) {
      const chunk = datas.slice(i, i + batchSize);
      if (chunk.length === 0) continue;
      const firestoreBatch = this.firestore.batch();
      const refs: DocumentReference[] = [];
      for (const raw of chunk) {
        const docRef = this.firestore.collection(collectionPath).doc();
        const payload = this.applyStoragePolicy(raw, true, effective);
        firestoreBatch.set(docRef, payload);
        refs.push(docRef);
      }
      await firestoreBatch.commit();
      for (const ref of refs) ids.push(ref.id);
    }
    return ids;
  }

  // ---------- Transactions ----------

  /**
   * Runs a Firestore transaction. Firestore will retry the callback
   * automatically on contention.
   */
  async performTransaction<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.firestore.runTransaction(operation);
  }

  // ---------- Listeners ----------

  /**
   * Listens for changes on a single document. Returns an `Unsubscribe`
   * function — call it to stop listening.
   *
   * @example
   * ```ts
   * const stop = db.onDocumentSnapshot<User>(
   *   'users/123',
   *   (user) => console.log('updated', user),
   *   (err) => console.error(err),
   * );
   * // later:
   * stop();
   * ```
   *
   * @returns an unsubscribe function.
   */
  onDocumentSnapshot<T extends DocumentData = DocumentData>(
    path: string,
    handler: (doc: WithId<T> | null) => void | Promise<void>,
    onError?: SnapshotErrorHandler,
  ): Unsubscribe {
    const ref = this.getDocumentRef<T>(path);
    const unsub = ref.onSnapshot(
      (snap: DocumentSnapshot<T>) => {
        if (!snap.exists) {
          void handler(null);
          return;
        }
        void handler({ id: snap.id, ...(snap.data() as T) } as WithId<T>);
      },
      (err) => {
        this.logger.error('firestore.listener.document.error', { path, message: err.message });
        onError?.(err);
      },
    );
    return unsub;
  }

  /**
   * Listens for changes on a collection (optionally filtered / ordered).
   * Invokes the handler with the current snapshot on every change.
   *
   * @returns an unsubscribe function.
   */
  onCollectionSnapshot<T extends DocumentData = DocumentData>(
    collectionPath: string,
    handler: (docs: Array<WithId<T>>) => void | Promise<void>,
    options: {
      filters?: QueryFilter[];
      orderBy?: QueryOrderBy[];
      limit?: number;
      onError?: SnapshotErrorHandler;
    } = {},
  ): Unsubscribe {
    let query: Query = this.firestore.collection(collectionPath);
    for (const f of options.filters ?? []) query = query.where(f.field, f.op, f.value);
    for (const o of options.orderBy ?? []) query = query.orderBy(o.field, o.direction ?? 'asc');
    if (options.limit !== undefined) query = query.limit(options.limit);

    const unsub = query.onSnapshot(
      (snap: QuerySnapshot) => {
        const docs = snap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as T) }) as WithId<T>,
        );
        void handler(docs);
      },
      (err) => {
        this.logger.error('firestore.listener.collection.error', {
          collectionPath,
          message: err.message,
        });
        options.onError?.(err);
      },
    );
    return unsub;
  }
}
