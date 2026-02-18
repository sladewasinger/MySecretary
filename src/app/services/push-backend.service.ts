import { Injectable, computed, signal } from '@angular/core';
import { TaskItem } from '../models/task-item';
import { readRuntimeConfig } from '../models/runtime-config';
import { UserSession } from './auth.store';

interface DeviceRegistrationPayload {
  subscription: PushSubscriptionJSON;
}

interface TaskSyncPayload {
  tasks: TaskItem[];
}

interface TaskFetchResponse {
  ok: boolean;
  tasks: TaskItem[];
}

interface DiagnosticsResponse {
  ok: boolean;
  pushConfigured: boolean;
  schedulerLastRunAt: string | null;
  deviceCount: number;
  taskCount: number;
  metrics: {
    lastSyncAt: string | null;
    lastSyncTaskCount: number;
    lastDeviceRegisterAt: string | null;
    lastDeviceCount: number;
    lastPushAttemptAt: string | null;
    lastPushSuccessAt: string | null;
    lastPushFailureAt: string | null;
    lastPushFailureMessage: string | null;
    lastPushedTaskId: string | null;
    lastSchedulerDueAt: string | null;
    lastSchedulerDueCount: number;
  };
}

export interface PushDiagnostics {
  backendReachable: boolean;
  pushConfigured: boolean;
  schedulerLastRunAt: string | null;
  deviceCount: number;
  taskCount: number;
  lastSyncAt: string | null;
  lastSyncTaskCount: number;
  lastDeviceRegisterAt: string | null;
  lastPushAttemptAt: string | null;
  lastPushSuccessAt: string | null;
  lastPushFailureAt: string | null;
  lastPushFailureMessage: string | null;
  lastPushedTaskId: string | null;
  lastSchedulerDueAt: string | null;
  lastSchedulerDueCount: number;
}

@Injectable({ providedIn: 'root' })
export class PushBackendService {
  private readonly runtimeConfig = readRuntimeConfig();
  private readonly vapidPublicKey = signal(this.runtimeConfig.vapidPublicKey);
  private readonly syncState = signal<'idle' | 'syncing' | 'ok' | 'error'>('idle');
  private readonly diagnosticsState = signal<PushDiagnostics>(this.emptyDiagnostics());
  private readonly lastRegisteredSessionKey = signal<string | null>(null);

  readonly state = this.syncState.asReadonly();
  readonly diagnostics = this.diagnosticsState.asReadonly();
  readonly usesBackend = computed(() => Boolean(this.runtimeConfig.apiBaseUrl.trim()));

  async syncUserTasks(session: UserSession, tasks: TaskItem[]): Promise<void> {
    if (!this.usesBackend() || !session.token) {
      return;
    }
    this.syncState.set('syncing');
    try {
      await this.registerDeviceIfReady(session);
      await this.postJson<TaskSyncPayload>(session.token, '/api/sync-tasks', {
        tasks
      });
      await this.refreshDiagnostics(session);
      this.syncState.set('ok');
    } catch {
      this.syncState.set('error');
      this.markBackendUnreachable();
    }
  }

  async loadServerTasks(session: UserSession): Promise<TaskItem[] | null> {
    if (!this.usesBackend() || !session.token) {
      return null;
    }
    try {
      const response = await fetch(this.toApiUrl('/api/tasks'), {
        method: 'GET',
        headers: this.withAuthHeaders(session.token)
      });
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as Partial<TaskFetchResponse>;
      if (!Array.isArray(payload.tasks)) {
        return null;
      }
      return payload.tasks;
    } catch {
      return null;
    }
  }

  async refreshDiagnostics(session: UserSession): Promise<void> {
    if (!this.usesBackend() || !session.token) {
      return;
    }
    try {
      const response = await fetch(this.toApiUrl('/api/diagnostics'), {
        method: 'GET',
        headers: this.withAuthHeaders(session.token)
      });
      if (!response.ok) {
        this.markBackendUnreachable();
        return;
      }
      const payload = (await response.json()) as Partial<DiagnosticsResponse>;
      this.diagnosticsState.set({
        backendReachable: true,
        pushConfigured: Boolean(payload.pushConfigured),
        schedulerLastRunAt: this.readOptionalString(payload.schedulerLastRunAt),
        deviceCount: this.readPositiveInt(payload.deviceCount),
        taskCount: this.readPositiveInt(payload.taskCount),
        lastSyncAt: this.readOptionalString(payload.metrics?.lastSyncAt),
        lastSyncTaskCount: this.readPositiveInt(payload.metrics?.lastSyncTaskCount),
        lastDeviceRegisterAt: this.readOptionalString(payload.metrics?.lastDeviceRegisterAt),
        lastPushAttemptAt: this.readOptionalString(payload.metrics?.lastPushAttemptAt),
        lastPushSuccessAt: this.readOptionalString(payload.metrics?.lastPushSuccessAt),
        lastPushFailureAt: this.readOptionalString(payload.metrics?.lastPushFailureAt),
        lastPushFailureMessage: this.readOptionalString(payload.metrics?.lastPushFailureMessage),
        lastPushedTaskId: this.readOptionalString(payload.metrics?.lastPushedTaskId),
        lastSchedulerDueAt: this.readOptionalString(payload.metrics?.lastSchedulerDueAt),
        lastSchedulerDueCount: this.readPositiveInt(payload.metrics?.lastSchedulerDueCount)
      });
    } catch {
      this.markBackendUnreachable();
    }
  }

  clearSession(): void {
    this.syncState.set('idle');
    this.lastRegisteredSessionKey.set(null);
    this.diagnosticsState.set(this.emptyDiagnostics());
  }

  private async registerDeviceIfReady(session: UserSession): Promise<void> {
    if (!session.token) {
      return;
    }
    const sessionKey = `${session.name.toLowerCase()}:${session.token}`;
    if (this.lastRegisteredSessionKey() === sessionKey) {
      return;
    }
    const vapidKey = await this.resolveVapidPublicKey();
    if (!vapidKey) {
      return;
    }
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }
    if (!('serviceWorker' in navigator)) {
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    if (!registration.pushManager) {
      return;
    }
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToArrayBuffer(vapidKey)
      }));
    await this.postJson<DeviceRegistrationPayload>(session.token, '/api/register-device', {
      subscription: subscription.toJSON()
    });
    this.lastRegisteredSessionKey.set(sessionKey);
  }

  private async postJson<TBody>(token: string, path: string, body: TBody): Promise<void> {
    const response = await fetch(this.toApiUrl(path), {
      method: 'POST',
      headers: this.withAuthHeaders(token),
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`Backend request failed: ${response.status}`);
    }
  }

  private async resolveVapidPublicKey(): Promise<string> {
    if (this.vapidPublicKey()) {
      return this.vapidPublicKey();
    }
    const response = await fetch(this.toApiUrl('/api/public-config'));
    if (!response.ok) {
      return '';
    }
    const payload = (await response.json()) as { vapidPublicKey?: string };
    const key = payload.vapidPublicKey?.trim() ?? '';
    if (key) {
      this.vapidPublicKey.set(key);
    }
    return key;
  }

  private withAuthHeaders(token: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    };
  }

  private toApiUrl(path: string): string {
    const base = this.runtimeConfig.apiBaseUrl.trim().replace(/\/+$/, '');
    return `${base}${path}`;
  }

  private markBackendUnreachable(): void {
    this.diagnosticsState.update((value) => ({
      ...value,
      backendReachable: false
    }));
  }

  private readOptionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private readPositiveInt(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return Math.floor(parsed);
  }

  private emptyDiagnostics(): PushDiagnostics {
    return {
      backendReachable: false,
      pushConfigured: false,
      schedulerLastRunAt: null,
      deviceCount: 0,
      taskCount: 0,
      lastSyncAt: null,
      lastSyncTaskCount: 0,
      lastDeviceRegisterAt: null,
      lastPushAttemptAt: null,
      lastPushSuccessAt: null,
      lastPushFailureAt: null,
      lastPushFailureMessage: null,
      lastPushedTaskId: null,
      lastSchedulerDueAt: null,
      lastSchedulerDueCount: 0
    };
  }

  private urlBase64ToArrayBuffer(value: string): ArrayBuffer {
    const base64 = value.padEnd(Math.ceil(value.length / 4) * 4, '=').replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(base64);
    const byteArray = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    return byteArray.buffer.slice(byteArray.byteOffset, byteArray.byteOffset + byteArray.byteLength);
  }
}
