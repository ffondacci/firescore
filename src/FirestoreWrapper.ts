import retry from 'async-retry';
import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type Transaction,
  type WriteBatch,
} from 'firebase-admin/firestore';

import type { FirInstance } from './FirInstance.js';
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

export class DocumentNotFoundError extends Error {
  readonly code = 'DOCUMENT_NOT_FOUND';
  constructor(public readonly path: string) {
    super(`Document not found: ${path}`);
    this.name = 'DocumentNotFoundError';
  }
}

export type WithId<T extends DocumentData> = T & { id: string };

export type PaginateHandler<T extends DocumentData> = (doc: WithId<T>) => void | Promise<void>;
export type PaginateCompleteHandler = () => void | Promise<void>;

export interface PaginateOptions<T extends DocumentData> {
  filters?: QueryFilter[];
  orderBy?: QueryOrderBy[];
  pageSize?: number;
  startAfterDoc?: DocumentSnapshot;
  storagePolicy?: StoragePolicyInput;
  onDocument: PaginateHandler<T>;
  onComplete?: PaginateCompleteHandler;
}

/**
 * Provides strongly-typed Firestore CRUD operations with retry + storage policies.
 */
export class FirestoreWrapper {
  readonly firestore: Firestore;
  retryPolicy: RetryPolicyOptions;
  storagePolicy: StoragePolicy;

  constructor(firInstance: FirInstance) {
    this.firestore = firInstance.firestore;
    this.retryPolicy = firInstance.retryPolicy;
    this.storagePolicy = firInstance.storagePolicy;
  }

  /** Executes a function with retry logic, bailing on non-retryable errors. */
  async executeWithRetry<T>(fn: () => Promise<T>, policy?: RetryPolicyOptions): Promise<T> {
    const retryConfig = policy ?? this.retryPolicy;
    return retry<T>(async (bail) => {
      try {
        return await fn();
      } catch (error) {
        if (!isRetryableError(error)) {
          bail(error instanceof Error ? error : new Error(String(error)));
          return undefined as never;
        }
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

  getDocumentRef<T extends DocumentData = DocumentData>(path: string): DocumentReference<T> {
    return this.firestore.doc(path) as DocumentReference<T>;
  }

  // ---------- Reads ----------

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

  async getMultipleDocuments<T extends DocumentData = DocumentData>(
    docPaths: string[],
  ): Promise<Array<WithId<T> | null>> {
    const snapshots = await Promise.all(docPaths.map((p) => this.firestore.doc(p).get()));
    return snapshots.map((doc) =>
      doc.exists ? ({ id: doc.id, ...(doc.data() as T) } as WithId<T>) : null,
    );
  }

  async documentExists(docPath: string): Promise<boolean> {
    const doc = await this.firestore.doc(docPath).get();
    return doc.exists;
  }

  // ---------- Writes ----------

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

  async deleteDocument(path: string, policy?: RetryPolicyOptions): Promise<void> {
    return this.executeWithRetry(async () => {
      await this.getDocumentRef(path).delete();
    }, policy);
  }

  async updateFieldsInDocument<T extends DocumentData>(
    docPath: string,
    data: Partial<T>,
  ): Promise<void> {
    await this.firestore.doc(docPath).update(data as DocumentData);
  }

  async deleteFieldInDocument(docPath: string, fields: string[]): Promise<void> {
    const updateData: DocumentData = {};
    for (const field of fields) {
      updateData[field] = FieldValue.delete();
    }
    await this.firestore.doc(docPath).update(updateData);
  }

  async incrementField(docPath: string, field: string, amount: number): Promise<void> {
    await this.firestore.doc(docPath).update({ [field]: FieldValue.increment(amount) });
  }

  async addElementInDocumentArray(
    docPath: string,
    arrayId: string,
    element: unknown,
  ): Promise<void> {
    await this.firestore.doc(docPath).update({
      [arrayId]: FieldValue.arrayUnion(element),
    });
  }

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

  async getCollection<T extends DocumentData = DocumentData>(
    collectionPath: string,
  ): Promise<Array<WithId<T>>> {
    const snapshot = await this.firestore.collection(collectionPath).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as T) }) as WithId<T>);
  }

  async listRootCollections(): Promise<string[]> {
    const collections = await this.firestore.listCollections();
    return collections.map((col) => col.id);
  }

  async listCollectionsUnderDocument(documentPath: string): Promise<string[]> {
    const collections = await this.firestore.doc(documentPath).listCollections();
    return collections.map((col) => col.id);
  }

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
   * Iterates a collection with cursor pagination.
   * Uses `onDocument` for each doc and `onComplete` when exhausted.
   */
  async queryPaginate<T extends DocumentData = DocumentData>(
    collectionPath: string,
    options: PaginateOptions<T>,
  ): Promise<void> {
    const effectivePolicy = this.resolvePolicy(options.storagePolicy);
    const pageSize = options.pageSize ?? effectivePolicy.pageSize;

    let cursor: DocumentSnapshot | undefined = options.startAfterDoc;

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
      }

      if (snapshot.size < pageSize) break;
      cursor = snapshot.docs[snapshot.docs.length - 1];
    }

    if (options.onComplete) await options.onComplete();
  }

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

  /** Firestore batches are capped at 500 operations. */
  static readonly MAX_BATCH_SIZE = 500;

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
    }
  }

  async batchUpdateDocuments<T extends DocumentData = DocumentData>(
    updates: Array<BatchUpdate<T>>,
    storagePolicy?: StoragePolicyInput,
  ): Promise<void> {
    const effective = this.resolvePolicy(storagePolicy);
    // Chunk to stay within Firestore's 500-op cap.
    for (let i = 0; i < updates.length; i += FirestoreWrapper.MAX_BATCH_SIZE) {
      const chunk = updates.slice(i, i + FirestoreWrapper.MAX_BATCH_SIZE);
      const batch: WriteBatch = this.firestore.batch();
      for (const u of chunk) {
        const docRef = this.firestore.doc(u.path);
        const data = this.applyStoragePolicy(u.data as DocumentData, false, effective);
        batch.update(docRef, data);
      }
      await batch.commit();
    }
  }

  async batchDeleteDocuments(docPaths: string[]): Promise<void> {
    for (let i = 0; i < docPaths.length; i += FirestoreWrapper.MAX_BATCH_SIZE) {
      const chunk = docPaths.slice(i, i + FirestoreWrapper.MAX_BATCH_SIZE);
      const batch = this.firestore.batch();
      for (const p of chunk) batch.delete(this.firestore.doc(p));
      await batch.commit();
    }
  }

  // ---------- Pushes ----------

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

  async performTransaction<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.firestore.runTransaction(operation);
  }
}
