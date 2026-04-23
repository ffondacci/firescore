import fs from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DocumentNotFoundError,
  FirInstance,
  FirestoreWrapper,
  MemoryLogger,
} from '../src/index.js';
import { tryLoadCredentials, uniqueAppName } from './helpers/credentials.js';

const DUMMY_DATA_PATH = path.resolve('resources/products.json');
const testCollectionId = 'tests';
const testUserData = { name: 'Test User', age: 25 };

interface Product {
  id: number | string;
  title?: string;
  price?: number;
  category?: string;
  availabilityStatus?: string;
  tags?: string[];
  [k: string]: unknown;
}

async function readJson<T>(p: string): Promise<T> {
  const content = await fs.readFile(p, 'utf-8');
  return JSON.parse(content) as T;
}

const credentials = await tryLoadCredentials();
const describeIf = credentials ? describe : describe.skip;

describeIf('FirestoreWrapper', () => {
  let instance: FirInstance;
  let wrapper: FirestoreWrapper;
  let logger: MemoryLogger;
  let products: Product[];

  beforeAll(async () => {
    logger = new MemoryLogger();
    instance = new FirInstance(credentials!, uniqueAppName('firestore-tests'), { logger });
    wrapper = new FirestoreWrapper(instance);
    const dataset = await readJson<{ products: Product[] }>(DUMMY_DATA_PATH);
    products = dataset.products;
  });

  afterAll(async () => {
    // Cleanup: wipe test collections we created to keep the remote DB tidy.
    for (const coll of [testCollectionId, 'tests_disposable', 'tests_pagination', 'tests_listener']) {
      try {
        await wrapper.deleteCollection(coll);
      } catch {
        /* noop */
      }
    }
    await instance.dispose();
  });

  it('adds a document and retrieves it', async () => {
    const docId = await wrapper.pushDocument(testCollectionId, testUserData);
    expect(typeof docId).toBe('string');
    const retrieved = await wrapper.getDocument<typeof testUserData>(
      `${testCollectionId}/${docId}`,
    );
    expect(retrieved.name).toBe(testUserData.name);
    expect(retrieved.age).toBe(testUserData.age);
  });

  it('pushes documents in batches', async () => {
    const ids = await wrapper.pushDocumentInBatches(testCollectionId, products, 15);
    expect(ids.length).toBeGreaterThan(0);
    const existsResults = await Promise.all(
      ids.map((id) => wrapper.documentExists(`${testCollectionId}/${id}`)),
    );
    expect(existsResults.every((v) => v === true)).toBe(true);
  });

  it('pushes a document and sets its docId key', async () => {
    const docId = await wrapper.pushDocumentAndSetKey(testCollectionId, testUserData);
    const retrieved = await wrapper.getDocument<{ docId: string }>(
      `${testCollectionId}/${docId}`,
    );
    expect(retrieved.docId).toBe(docId);
  });

  it('sets and reads a document at a given path', async () => {
    const product = { ...products[1]!, test: 'test' };
    const p = `${testCollectionId}/test_product`;
    await wrapper.setDocument(p, product);
    const retrieved = await wrapper.getDocument(p);
    expect(Object.keys(retrieved).length).toBeGreaterThan(0);
  });

  it('batch-updates multiple documents', async () => {
    await wrapper.setDocumentsInBatches(
      testCollectionId,
      [
        { id: '10', price: 0, availabilityStatus: 'unknown' },
        { id: '11', price: 0, availabilityStatus: 'unknown' },
        { id: '12', price: 0, availabilityStatus: 'unknown' },
      ],
      1,
      'id',
    );

    const updates = [
      { path: `${testCollectionId}/10`, data: { price: 19.99, availabilityStatus: 'High Stock' } },
      { path: `${testCollectionId}/11`, data: { price: 29.99, availabilityStatus: 'High Stock' } },
      { path: `${testCollectionId}/12`, data: { price: 9.99, availabilityStatus: 'High Stock' } },
    ];
    await wrapper.batchUpdateDocuments(updates);

    const docs = await wrapper.getMultipleDocuments<Product>(updates.map((u) => u.path));
    expect(docs).toHaveLength(3);
    for (let i = 0; i < updates.length; i += 1) {
      expect(docs[i]?.price).toBe(updates[i]!.data.price);
      expect(docs[i]?.availabilityStatus).toBe(updates[i]!.data.availabilityStatus);
    }
  });

  it('deletes a document and throws DocumentNotFoundError afterwards', async () => {
    const p = `${testCollectionId}/test_product`;
    await expect(wrapper.getDocument(p)).resolves.toBeDefined();
    await wrapper.deleteDocument(p);
    await expect(wrapper.getDocument(p)).rejects.toBeInstanceOf(DocumentNotFoundError);
  });

  it('sets a bunch of documents in batches', async () => {
    await wrapper.setDocumentsInBatches(testCollectionId, products, 5, 'id');
    const collection = await wrapper.getCollection(testCollectionId);
    expect(collection.length).toBeGreaterThan(0);
  });

  it('gets a document at a given path (by id 1)', async () => {
    const doc = await wrapper.getDocument<Product>(`${testCollectionId}/1`);
    expect(Object.keys(doc).length).toBeGreaterThan(0);
  });

  it('queries products with price > 4.0', async () => {
    const result = await wrapper.queryDocuments<Product>(testCollectionId, [
      { field: 'price', op: '>', value: 4.0 },
    ]);
    expect(result.length).toBeGreaterThan(0);
  });

  it('increments a field in a document', async () => {
    const p = `${testCollectionId}/1`;
    const before = (await wrapper.getDocument<Product>(p)).price ?? 0;
    await wrapper.incrementField(p, 'price', 5);
    const after = (await wrapper.getDocument<Product>(p)).price ?? 0;
    expect(after).toBeCloseTo(before + 5);
  });

  it('decrements a field in a document', async () => {
    const p = `${testCollectionId}/1`;
    const before = (await wrapper.getDocument<Product>(p)).price ?? 0;
    await wrapper.incrementField(p, 'price', -5);
    const after = (await wrapper.getDocument<Product>(p)).price ?? 0;
    expect(after).toBeCloseTo(before - 5);
  });

  it('batch-deletes multiple documents', async () => {
    const paths = [1, 2, 3].map((i) => `${testCollectionId}/${i}`);
    await wrapper.setDocumentsInBatches(testCollectionId, products.slice(1, 4), 5, 'id');
    await wrapper.batchDeleteDocuments(paths);
    const existResults = await Promise.all(paths.map((p) => wrapper.documentExists(p)));
    expect(existResults.every((v) => v === false)).toBe(true);
  });

  it('transfers balance between two users atomically', async () => {
    const userA = { id: 'userA', balance: 100 };
    const userB = { id: 'userB', balance: 50 };
    await wrapper.setDocumentsInBatches(testCollectionId, [userA, userB], 1, 'id');

    await wrapper.performTransaction(async (tx) => {
      const refA = wrapper.getDocumentRef(`${testCollectionId}/userA`);
      const refB = wrapper.getDocumentRef(`${testCollectionId}/userB`);
      const [docA, docB] = await Promise.all([tx.get(refA), tx.get(refB)]);
      const balA = (docA.data() as { balance: number }).balance;
      const balB = (docB.data() as { balance: number }).balance;
      if (balA < 30) throw new Error('Insufficient funds');
      tx.update(refA, { balance: balA - 30 });
      tx.update(refB, { balance: balB + 30 });
    });

    const updatedA = await wrapper.getDocument<{ balance: number }>(`${testCollectionId}/userA`);
    const updatedB = await wrapper.getDocument<{ balance: number }>(`${testCollectionId}/userB`);
    expect(updatedA.balance).toBe(70);
    expect(updatedB.balance).toBe(80);
  });

  it('deletes specific fields from a document', async () => {
    const product = products[1]!;
    const p = `${testCollectionId}/productDelete`;
    await wrapper.setDocument(p, product);
    await wrapper.deleteFieldInDocument(p, ['price', 'category']);
    const updated = await wrapper.getDocument<Product>(p);
    expect(updated.price).toBeUndefined();
    expect(updated.category).toBeUndefined();
  });

  it('adds an element to an array field in a document', async () => {
    const p = `${testCollectionId}/productAddTag`;
    await wrapper.setDocument(p, { ...products[1]! });
    await wrapper.addElementInDocumentArray(p, 'tags', 'makeup');
    const doc = await wrapper.getDocument<Product>(p);
    expect(doc.tags).toContain('makeup');
  });

  it('removes an element from an array field in a document', async () => {
    const p = `${testCollectionId}/productRemoveTag`;
    await wrapper.setDocument(p, { ...products[1]! });
    await wrapper.removeElementInDocumentArray(p, 'tags', 'mascara');
    const doc = await wrapper.getDocument<Product>(p);
    expect(doc.tags ?? []).not.toContain('mascara');
  });

  it('updates specific fields in a document', async () => {
    const p = `${testCollectionId}/productUpdateFields`;
    await wrapper.setDocument(p, { ...products[1]! });
    await wrapper.updateFieldsInDocument<Product>(p, {
      price: 14.99,
      availabilityStatus: 'Out of Stock',
    });
    const updated = await wrapper.getDocument<Product>(p);
    expect(updated.price).toBe(14.99);
    expect(updated.availabilityStatus).toBe('Out of Stock');
  });

  it('lists root-level collections', async () => {
    await wrapper.setDocument(`${testCollectionId}/doc1`, { name: 'RootDoc1' });
    const roots = await wrapper.listRootCollections();
    expect(roots).toContain(testCollectionId);
  });

  it('lists sub-collections under a document', async () => {
    const parent = `${testCollectionId}/parentDoc`;
    await wrapper.setDocument(parent, { name: 'Parent' });
    await wrapper.setDocument(`${parent}/subCollection1/doc1`, { name: 'SubDoc1' });
    await wrapper.setDocument(`${parent}/subCollection2/doc2`, { name: 'SubDoc2' });
    const subs = await wrapper.listCollectionsUnderDocument(parent);
    expect(subs).toEqual(expect.arrayContaining(['subCollection1', 'subCollection2']));
  });

  it('deletes an entire collection', async () => {
    const disposable = 'tests_disposable';
    await wrapper.setDocumentsInBatches(disposable, products.slice(0, 10), 2, 'id');
    expect((await wrapper.getCollection(disposable)).length).toBeGreaterThan(0);
    await wrapper.deleteCollection(disposable);
    expect(await wrapper.getCollection(disposable)).toEqual([]);
  });

  // ---------- Modern APIs ----------

  describe('queryPaginate', () => {
    const coll = 'tests_pagination';

    beforeAll(async () => {
      const items = Array.from({ length: 23 }, (_, i) => ({
        id: `p${i}`,
        n: i,
      }));
      await wrapper.setDocumentsInBatches(coll, items, 1, 'id');
    });

    it('iterates every document across multiple pages', async () => {
      const seen: string[] = [];
      let completed = false;

      await wrapper.queryPaginate<{ n: number }>(coll, {
        orderBy: [{ field: 'n', direction: 'asc' }],
        pageSize: 10,
        onDocument: (doc) => {
          seen.push(doc.id);
        },
        onComplete: () => {
          completed = true;
        },
      });

      expect(seen).toHaveLength(23);
      expect(new Set(seen).size).toBe(23);
      expect(completed).toBe(true);
    });

    it('respects filters', async () => {
      const seen: string[] = [];
      await wrapper.queryPaginate<{ n: number }>(coll, {
        filters: [{ field: 'n', op: '>=', value: 20 }],
        orderBy: [{ field: 'n', direction: 'asc' }],
        pageSize: 5,
        onDocument: (doc) => {
          seen.push(doc.id);
        },
      });
      expect(seen).toHaveLength(3); // n=20, 21, 22
    });
  });

  describe('queryPage (cursor-based)', () => {
    const coll = 'tests_pagination';

    it('returns a cursor usable to fetch the next page', async () => {
      const page1 = await wrapper.queryPage<{ n: number }>({
        collectionPath: coll,
        orderBy: [{ field: 'n', direction: 'asc' }],
        pageSize: 10,
      });
      expect(page1.docs).toHaveLength(10);
      expect(page1.hasMore).toBe(true);
      expect(page1.cursor).not.toBeNull();

      const page2 = await wrapper.queryPage<{ n: number }>({
        collectionPath: coll,
        orderBy: [{ field: 'n', direction: 'asc' }],
        pageSize: 10,
        cursor: page1.cursor,
      });
      expect(page2.docs).toHaveLength(10);
      expect(page2.docs[0]!.n).toBe(10);

      const page3 = await wrapper.queryPage<{ n: number }>({
        collectionPath: coll,
        orderBy: [{ field: 'n', direction: 'asc' }],
        pageSize: 10,
        cursor: page2.cursor,
      });
      expect(page3.docs).toHaveLength(3); // remainder
      expect(page3.hasMore).toBe(false);
      expect(page3.cursor).toBeNull();
    });
  });

  describe('collectionGroup', () => {
    it('finds documents across subcollections sharing an id', async () => {
      // Use a unique collection id to avoid leftovers from previous runs.
      // Filters on collection groups require a composite index in Firestore,
      // so we fetch everything and filter client-side.
      const groupId = `reviews_cg_${Date.now()}`;
      await wrapper.setDocument(`${testCollectionId}/postA/${groupId}/r1`, { rating: 5 });
      await wrapper.setDocument(`${testCollectionId}/postA/${groupId}/r2`, { rating: 3 });
      await wrapper.setDocument(`${testCollectionId}/postB/${groupId}/r3`, { rating: 5 });

      const all = await wrapper.collectionGroup<{ rating: number }>(groupId);
      const ids = all.map((d) => d.id).sort();
      expect(ids).toEqual(['r1', 'r2', 'r3']);

      const fives = all.filter((d) => d.rating === 5).map((d) => d.id).sort();
      expect(fives).toEqual(['r1', 'r3']);

      // Cleanup
      await wrapper.batchDeleteDocuments([
        `${testCollectionId}/postA/${groupId}/r1`,
        `${testCollectionId}/postA/${groupId}/r2`,
        `${testCollectionId}/postB/${groupId}/r3`,
      ]);
    });
  });

  describe('onDocumentSnapshot', () => {
    it('receives updates and stops on unsubscribe', async () => {
      const p = `tests_listener/doc`;
      await wrapper.setDocument(p, { v: 0 });

      const received: Array<number | null> = [];
      const done = new Promise<void>((resolve) => {
        const stop = wrapper.onDocumentSnapshot<{ v: number }>(p, (doc) => {
          received.push(doc?.v ?? null);
          if (received.length === 2) {
            stop();
            resolve();
          }
        });
        // Trigger a change after the initial snapshot lands.
        setTimeout(() => {
          void wrapper.updateFieldsInDocument(p, { v: 42 });
        }, 400);
      });

      await done;
      expect(received[0]).toBe(0);
      expect(received[1]).toBe(42);
    }, 20_000);
  });

  describe('onCollectionSnapshot', () => {
    it('receives collection updates', async () => {
      const coll = 'tests_listener_coll';
      // reset
      try {
        await wrapper.deleteCollection(coll);
      } catch {
        /* noop */
      }

      const received: number[] = [];
      const done = new Promise<void>((resolve) => {
        const stop = wrapper.onCollectionSnapshot<{ v: number }>(
          coll,
          (docs) => {
            received.push(docs.length);
            if (received.length >= 2 && docs.length >= 1) {
              stop();
              resolve();
            }
          },
        );
        setTimeout(() => {
          void wrapper.setDocument(`${coll}/x`, { v: 1 });
        }, 400);
      });

      await done;
      expect(received[0]).toBe(0);
      expect(received[received.length - 1]).toBeGreaterThanOrEqual(1);

      await wrapper.deleteCollection(coll);
    }, 20_000);
  });
});
