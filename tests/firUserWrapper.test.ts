import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FirInstance, FirUserWrapper } from '../src/index.js';
import { tryLoadCredentials, uniqueAppName } from './helpers/credentials.js';

const credentials = await tryLoadCredentials();
const describeIf = credentials ? describe : describe.skip;

describeIf('FirUserWrapper', () => {
  let instance: FirInstance;
  let users: FirUserWrapper;
  let authAvailable = true;
  const createdUids: string[] = [];

  const email = `firescore-${Date.now()}@example.test`;
  const password = 'P@ssw0rd-firescore';

  beforeAll(async () => {
    instance = new FirInstance(credentials!, uniqueAppName('user-tests'));
    users = new FirUserWrapper(instance);

    // Probe that Firebase Authentication is enabled on the project.
    try {
      await users.listUsers(1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('configuration corresponding to the provided identifier')) {
        console.warn('[firUserWrapper] Firebase Auth not enabled on project — skipping tests.');
        authAvailable = false;
      } else {
        throw err;
      }
    }
  });

  afterAll(async () => {
    if (authAvailable) {
      for (const uid of createdUids) {
        await users.deleteUser(uid).catch(() => undefined);
      }
    }
    await instance.dispose();
  });

  const itIf = (name: string, fn: () => Promise<void>, timeout?: number): void => {
    it(
      name,
      async () => {
        if (!authAvailable) return;
        await fn();
      },
      timeout,
    );
  };

  itIf('creates a user and fetches it by uid and email', async () => {
    const record = await users.createUser({
      email,
      password,
      displayName: 'FireScore Test',
    });
    createdUids.push(record.uid);
    expect(record.email).toBe(email);

    const byUid = await users.getUserRecord(record.uid);
    expect(byUid.uid).toBe(record.uid);

    const byEmail = await users.getUserByEmail(email);
    expect(byEmail.uid).toBe(record.uid);

    expect(await users.checkUserExists(record.uid)).toBe(true);
  }, 20_000);

  itIf('sets custom claims', async () => {
    const uid = createdUids[0];
    if (!uid) throw new Error('previous test did not create user');
    await users.setUserCustomClaims(uid, { role: 'admin', tier: 2 });
    const fresh = await users.getUserRecord(uid);
    expect(fresh.customClaims).toEqual({ role: 'admin', tier: 2 });
  }, 20_000);

  itIf('disables then re-enables a user', async () => {
    const uid = createdUids[0];
    if (!uid) throw new Error('previous test did not create user');
    const disabled = await users.disableUser(uid);
    expect(disabled.disabled).toBe(true);
    const enabled = await users.enableUser(uid);
    expect(enabled.disabled).toBe(false);
  }, 20_000);

  itIf('updates arbitrary properties', async () => {
    const uid = createdUids[0];
    if (!uid) throw new Error('previous test did not create user');
    const updated = await users.updateUser(uid, { displayName: 'Renamed FireScore' });
    expect(updated.displayName).toBe('Renamed FireScore');
  }, 20_000);

  itIf('creates a custom token', async () => {
    const uid = createdUids[0];
    if (!uid) throw new Error('previous test did not create user');
    const token = await users.createCustomToken(uid, { ctx: 'test' });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
  }, 20_000);

  itIf('lists users (contains our created user)', async () => {
    const uid = createdUids[0];
    if (!uid) throw new Error('previous test did not create user');
    const result = await users.listUsers(1000);
    expect(result.users.some((u) => u.uid === uid)).toBe(true);
  }, 30_000);

  itIf('returns false for a non-existent user', async () => {
    expect(await users.checkUserExists('non-existent-uid-xyzzy')).toBe(false);
  }, 10_000);

  itIf('deletes a user', async () => {
    // Create a throwaway user for this test so we preserve the main one for the
    // tests above (which are order-sensitive).
    const throwaway = await users.createUser({
      email: `firescore-throwaway-${Date.now()}@example.test`,
      password,
    });
    await users.deleteUser(throwaway.uid);
    expect(await users.checkUserExists(throwaway.uid)).toBe(false);
  }, 20_000);
});
