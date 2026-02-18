import { computed, Injectable, signal } from '@angular/core';

export interface UserSession {
  name: string;
  token: string | null;
  expiresAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly storageKey = 'my-secretary-session';
  private readonly legacyStorageKey = 'my-secretary-user';
  private readonly sessionState = signal<UserSession | null>(this.readSession());

  readonly session = this.sessionState.asReadonly();
  readonly isLoggedIn = computed(() => this.sessionState() !== null);

  setSession(session: UserSession): void {
    const normalizedName = session.name.trim();
    if (!normalizedName || (session.token !== null && !session.token.trim())) {
      return;
    }
    const normalizedSession: UserSession = {
      name: normalizedName,
      token: session.token?.trim() || null,
      expiresAt: session.expiresAt?.trim() || null
    };
    this.sessionState.set(normalizedSession);
    localStorage.setItem(this.storageKey, JSON.stringify(normalizedSession));
  }

  logout(): void {
    this.sessionState.set(null);
    localStorage.removeItem(this.storageKey);
  }

  private readSession(): UserSession | null {
    const storedValue = localStorage.getItem(this.storageKey) ?? this.migrateLegacySession();
    if (!storedValue) {
      return null;
    }
    try {
      const parsed = JSON.parse(storedValue) as Partial<UserSession>;
      if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
        return null;
      }
      const token = typeof parsed.token === 'string' && parsed.token.trim() ? parsed.token.trim() : null;
      const expiresAt =
        typeof parsed.expiresAt === 'string' && parsed.expiresAt.trim() ? parsed.expiresAt.trim() : null;
      return {
        name: parsed.name.trim(),
        token,
        expiresAt
      };
    } catch {
      return null;
    }
  }

  private migrateLegacySession(): string | null {
    const legacyValue = localStorage.getItem(this.legacyStorageKey);
    if (!legacyValue) {
      return null;
    }
    try {
      const parsed = JSON.parse(legacyValue) as { name?: string };
      if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
        return null;
      }
      const migratedSession: UserSession = {
        name: parsed.name.trim(),
        token: null,
        expiresAt: null
      };
      const serializedSession = JSON.stringify(migratedSession);
      localStorage.setItem(this.storageKey, serializedSession);
      localStorage.removeItem(this.legacyStorageKey);
      return serializedSession;
    } catch {
      return null;
    }
  }
}
