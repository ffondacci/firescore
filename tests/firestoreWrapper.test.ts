import fs from 'node:fs/promises';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { FirInstance, FirestoreWrapper, DocumentNotFoundError } from '../src/index.js';
import type { ServiceAccountCredentials } from '../src/index.js';

/**
 * Integration tests — require a real Firestore project and credentials.
 *
 * Provide credentials via one of:
 *   - env var `FIREBASE_CREDENTIALS_PATH` pointing to a service-account JSON
 *   - a file at `./credentials/credential-helper.json`
 *
 * Tests are skipped automatically when credentials cannot be resolved.
 */

const CREDENTIALS_PATH =
  process.env.FIREBASE_CREDENTIALS_PATH ?? './credentials/credential-helper.json';
const DUMMY_DATA_PATH = path.resolve('resources/products.json');

const testCollectionId = 'tests';
const testUserData = { name: 'Test User', age: 25 };

async function readJson<T>(p: string): Promise<T> {
  const content = await fs.readFile(p, 'utf-8');
  return JSON.parse(content) as T;
}

async function tryLoadCredentials(): Promise<ServiceAccountCredentials | null> {
  try {
    await fs.access(CREDENTIALS_PATH);
    return readJson<ServiceAccountCredentials>(CREDENTIALS_PATH);
  } catch {
    return null;
  }
}

interface Product {
  id: number | string;
  title?: string;
  price?: number;
  category?: string;
  availabilityStatus?: string;
  tags?: string[];
  [k: string]: unknown;
}

const credentials = await tryLoadCredentials();
const describeIf = credentials ? describe : describe.skip;

describeIf('FirestoreWrapper', () => {
  let wrapper: FirestoreWrapper;
  let products: Product[];

  beforeAll(async () => {
    const instance = new FirInstance(
      credentials!,
      (credentials!.project_id as string) ?? 'firescore-tests',
    );
    wrapper = new FirestoreWrapper(instance);
    const dataset = await readJson<{ products: Product[] }>(DUMMY_DATA_PATH);
    products = dataset.products;
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
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBeGreaterThan(0);

    const existsResults = await Promise.all(
      ids.map((id) => wrapper.documentExists(`${testCollectionId}/${id}`)),
    );
    expect(existsResults.every((v) => v === true)).toBe(true);
  });

  it('pushes a document and sets its docId key', async () => {
    const docId = await wrapper.pushDocumentAndSetKey(testCollectionId, testUserData);
    expect(typeof docId).toBe('string');
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
    expect(retrieved).toBeDefined();
    expect(Object.keys(retrieved).length).toBeGreaterThan(0);
  });

  it('batch-updates multiple documents', async () => {
    // Seed the documents that will be updated — update() requires existing docs.
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
      expect(docs[i]).not.toBeNull();
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
    expect(doc).toBeDefined();
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
    const newTag = 'makeup';
    await wrapper.addElementInDocumentArray(p, 'tags', newTag);
    const doc = await wrapper.getDocument<Product>(p);
    expect(doc.tags).toContain(newTag);
  });

  it('removes an element from an array field in a document', async () => {
    const p = `${testCollectionId}/productRemoveTag`;
    await wrapper.setDocument(p, { ...products[1]! });
    const tagToRemove = 'mascara';
    await wrapper.removeElementInDocumentArray(p, 'tags', tagToRemove);
    const doc = await wrapper.getDocument<Product>(p);
    expect(doc.tags ?? []).not.toContain(tagToRemove);
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
    const before = await wrapper.getCollection(disposable);
    expect(before.length).toBeGreaterThan(0);

    await wrapper.deleteCollection(disposable);
    const after = await wrapper.getCollection(disposable);
    expect(after).toEqual([]);
  });
});
