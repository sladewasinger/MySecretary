import { Injectable, computed, signal } from '@angular/core';
import { UserSession } from './auth.store';
import { readRuntimeConfig } from '../models/runtime-config';

export interface AuthRequest {
  userName: string;
  password: string;
  mode: 'login' | 'register';
}

interface AuthResponse {
  ok: boolean;
  userName: string;
  token: string;
  expiresAt: string;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class BackendAuthService {
  private readonly runtimeConfig = readRuntimeConfig();
  private readonly authState = signal<'idle' | 'authenticating' | 'ok' | 'error'>('idle');
  private readonly errorState = signal<string | null>(null);

  readonly state = this.authState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly usesBackendAuth = computed(() => Boolean(this.runtimeConfig.apiBaseUrl.trim()));

  async authenticate(request: AuthRequest): Promise<UserSession | null> {
    const userName = request.userName.trim();
    if (!this.usesBackendAuth()) {
      if (!userName) {
        this.authState.set('error');
        this.errorState.set('Username is required.');
        return null;
      }
      this.authState.set('ok');
      this.errorState.set(null);
      return {
        name: userName,
        token: null,
        expiresAt: null
      };
    }
    const password = request.password;
    if (!userName || !password) {
      this.authState.set('error');
      this.errorState.set('Username and password are required.');
      return null;
    }

    this.authState.set('authenticating');
    this.errorState.set(null);

    try {
      const response = await fetch(this.toApiUrl(request.mode === 'register' ? '/api/auth/register' : '/api/auth/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userName,
          password
        })
      });
      const payload = (await response.json()) as Partial<AuthResponse>;
      if (!response.ok || !payload.token || !payload.userName) {
        this.authState.set('error');
        this.errorState.set(payload.error?.trim() || 'Authentication failed.');
        return null;
      }
      this.authState.set('ok');
      this.errorState.set(null);
      return {
        name: payload.userName,
        token: payload.token,
        expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : null
      };
    } catch {
      this.authState.set('error');
      this.errorState.set('Authentication request failed.');
      return null;
    }
  }

  resetState(): void {
    this.authState.set('idle');
    this.errorState.set(null);
  }

  private toApiUrl(path: string): string {
    const base = this.runtimeConfig.apiBaseUrl.trim().replace(/\/+$/, '');
    return `${base}${path}`;
  }
}
