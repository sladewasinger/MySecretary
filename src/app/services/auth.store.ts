import { computed, Injectable, signal } from '@angular/core';

export interface UserSession {
  name: string;
}

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly storageKey = 'my-secretary-user';
  private readonly sessionState = signal<UserSession | null>(this.readSession());

  readonly session = this.sessionState.asReadonly();
  readonly isLoggedIn = computed(() => this.sessionState() !== null);

  login(name: string): void {
    const normalizedName = name.trim();
    if (!normalizedName) {
      return;
    }
    const session = { name: normalizedName };
    this.sessionState.set(session);
    localStorage.setItem(this.storageKey, JSON.stringify(session));
  }

  logout(): void {
    this.sessionState.set(null);
    localStorage.removeItem(this.storageKey);
  }

  private readSession(): UserSession | null {
    const storedValue = localStorage.getItem(this.storageKey);
    if (!storedValue) {
      return null;
    }
    try {
      const parsed = JSON.parse(storedValue) as UserSession;
      return typeof parsed.name === 'string' && parsed.name.trim() ? parsed : null;
    } catch {
      return null;
    }
  }
}
