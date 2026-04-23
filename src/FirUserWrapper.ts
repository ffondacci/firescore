import {
  getAuth,
  type Auth,
  type CreateRequest,
  type ListUsersResult,
  type UpdateRequest,
  type UserRecord,
} from 'firebase-admin/auth';

import type { FirInstance } from './FirInstance.js';

/**
 * Firebase Auth wrapper. Thin, typed helpers on top of `firebase-admin/auth`.
 *
 * @example
 * ```ts
 * const users = new FirUserWrapper(instance);
 * const record = await users.createUser({ email: 'a@b.com', password: 'xxxxxx' });
 * await users.setUserCustomClaims(record.uid, { role: 'admin' });
 * ```
 */
export class FirUserWrapper {
  readonly auth: Auth;

  constructor(firInstance: FirInstance) {
    this.auth = getAuth(firInstance.app);
  }

  /** Creates a new user. */
  createUser(properties: CreateRequest): Promise<UserRecord> {
    return this.auth.createUser(properties);
  }

  /** Returns `true` if a user with that uid exists. */
  async checkUserExists(uid: string): Promise<boolean> {
    try {
      await this.auth.getUser(uid);
      return true;
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      if (code === 'auth/user-not-found') return false;
      throw error;
    }
  }

  /** Gets a user record by uid. Throws `auth/user-not-found` if missing. */
  getUserRecord(uid: string): Promise<UserRecord> {
    return this.auth.getUser(uid);
  }

  /** Gets a user by email. */
  getUserByEmail(email: string): Promise<UserRecord> {
    return this.auth.getUserByEmail(email);
  }

  /** Gets a user by phone number. */
  getUserByPhoneNumber(phoneNumber: string): Promise<UserRecord> {
    return this.auth.getUserByPhoneNumber(phoneNumber);
  }

  /**
   * Sets custom claims on a user. Claims are included in the ID token and
   * can be used by security rules.
   */
  setUserCustomClaims(uid: string, claims: Record<string, unknown>): Promise<void> {
    return this.auth.setCustomUserClaims(uid, claims);
  }

  /** Lists users, paginated. `limit` defaults to 1000. */
  listUsers(limit = 1000, pageToken?: string): Promise<ListUsersResult> {
    return this.auth.listUsers(limit, pageToken);
  }

  /** Revokes all refresh tokens, forcing the user to re-authenticate. */
  forceUserPasswordReset(uid: string): Promise<void> {
    return this.auth.revokeRefreshTokens(uid);
  }

  /** Disables the account. */
  async disableUser(uid: string): Promise<UserRecord> {
    return this.auth.updateUser(uid, { disabled: true });
  }

  /** Re-enables a disabled account. */
  async enableUser(uid: string): Promise<UserRecord> {
    return this.auth.updateUser(uid, { disabled: false });
  }

  /** Permanently deletes a user. */
  deleteUser(uid: string): Promise<void> {
    return this.auth.deleteUser(uid);
  }

  /** Arbitrary update on a user record. */
  updateUser(uid: string, properties: UpdateRequest): Promise<UserRecord> {
    return this.auth.updateUser(uid, properties);
  }

  /** Generates an email verification link (send it yourself). */
  generateEmailVerificationLink(email: string): Promise<string> {
    return this.auth.generateEmailVerificationLink(email);
  }

  /** Generates a password reset link. */
  generatePasswordResetLink(email: string): Promise<string> {
    return this.auth.generatePasswordResetLink(email);
  }

  /** Creates a custom token for a given uid (used by clients to sign in). */
  createCustomToken(uid: string, developerClaims?: Record<string, unknown>): Promise<string> {
    return this.auth.createCustomToken(uid, developerClaims);
  }
}
