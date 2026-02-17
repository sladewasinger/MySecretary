import { Injectable, signal } from '@angular/core';
import { TaskItem } from '../models/task-item';
import { readRuntimeConfig } from '../models/runtime-config';

interface DeviceRegistrationPayload {
  userName: string;
  subscription: PushSubscriptionJSON;
}

interface TaskSyncPayload {
  userName: string;
  tasks: TaskItem[];
}

@Injectable({ providedIn: 'root' })
export class PushBackendService {
  private readonly runtimeConfig = readRuntimeConfig();
  private readonly vapidPublicKey = signal(this.runtimeConfig.vapidPublicKey);
  private readonly syncState = signal<'idle' | 'syncing' | 'ok' | 'error'>('idle');
  private readonly lastRegisteredUser = signal<string | null>(null);

  readonly state = this.syncState.asReadonly();

  async syncUserTasks(userName: string, tasks: TaskItem[]): Promise<void> {
    if (!userName.trim() || !this.runtimeConfig.apiBaseUrl) {
      return;
    }
    this.syncState.set('syncing');
    try {
      await this.registerDeviceIfReady(userName);
      await this.postJson<TaskSyncPayload>('/api/sync-tasks', {
        userName,
        tasks
      });
      this.syncState.set('ok');
    } catch {
      this.syncState.set('error');
    }
  }

  private async registerDeviceIfReady(userName: string): Promise<void> {
    if (this.lastRegisteredUser() === userName) {
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
    await this.postJson<DeviceRegistrationPayload>('/api/register-device', {
      userName,
      subscription: subscription.toJSON()
    });
    this.lastRegisteredUser.set(userName);
  }

  private async postJson<TBody>(path: string, body: TBody): Promise<void> {
    const response = await fetch(`${this.runtimeConfig.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
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
    if (!this.runtimeConfig.apiBaseUrl) {
      return '';
    }
    const response = await fetch(`${this.runtimeConfig.apiBaseUrl}/api/public-config`);
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

  private urlBase64ToArrayBuffer(value: string): ArrayBuffer {
    const base64 = value.padEnd(Math.ceil(value.length / 4) * 4, '=').replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(base64);
    const byteArray = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    return byteArray.buffer.slice(byteArray.byteOffset, byteArray.byteOffset + byteArray.byteLength);
  }
}
