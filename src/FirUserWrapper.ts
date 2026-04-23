import {
  getAuth,
  type Auth,
  type ListUsersResult,
  type UpdateRequest,
  type UserRecord,
} from 'firebase-admin/auth';

import type { FirInstance } from './FirInstance.js';

export class FirUserWrapper {
  readonly auth: Auth;

  constructor(firInstance: FirInstance) {
    this.auth = getAuth(firInstance.app);
  }

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

  getUserRecord(uid: string): Promise<UserRecord> {
    return this.auth.getUser(uid);
  }

  getUserByEmail(email: string): Promise<UserRecord> {
    return this.auth.getUserByEmail(email);
  }

  getUserByPhoneNumber(phoneNumber: string): Promise<UserRecord> {
    return this.auth.getUserByPhoneNumber(phoneNumber);
  }

  setUserCustomClaims(uid: string, claims: Record<string, unknown>): Promise<void> {
    return this.auth.setCustomUserClaims(uid, claims);
  }

  listUsers(limit = 1000, pageToken?: string): Promise<ListUsersResult> {
    return this.auth.listUsers(limit, pageToken);
  }

  forceUserPasswordReset(uid: string): Promise<void> {
    return this.auth.revokeRefreshTokens(uid);
  }

  async disableUser(uid: string): Promise<UserRecord> {
    return this.auth.updateUser(uid, { disabled: true });
  }

  async enableUser(uid: string): Promise<UserRecord> {
    return this.auth.updateUser(uid, { disabled: false });
  }

  deleteUser(uid: string): Promise<void> {
    return this.auth.deleteUser(uid);
  }

  updateUser(uid: string, properties: UpdateRequest): Promise<UserRecord> {
    return this.auth.updateUser(uid, properties);
  }

  generateEmailVerificationLink(email: string): Promise<string> {
    return this.auth.generateEmailVerificationLink(email);
  }

  generatePasswordResetLink(email: string): Promise<string> {
    return this.auth.generatePasswordResetLink(email);
  }
}
