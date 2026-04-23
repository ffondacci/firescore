import fs from 'node:fs/promises';

import type { ServiceAccountCredentials } from '../../src/index.js';

const CREDENTIALS_PATH =
  process.env.FIREBASE_CREDENTIALS_PATH ?? './credentials/credential-helper.json';

export async function tryLoadCredentials(): Promise<ServiceAccountCredentials | null> {
  try {
    await fs.access(CREDENTIALS_PATH);
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
    return JSON.parse(content) as ServiceAccountCredentials;
  } catch {
    return null;
  }
}

/**
 * Generates a unique app name per test file so concurrent `initializeApp`
 * calls don't collide.
 */
export function uniqueAppName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
