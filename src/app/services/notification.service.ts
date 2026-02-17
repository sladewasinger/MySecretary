import { Injectable, signal } from '@angular/core';
import { AuthStore } from './auth.store';
import { TaskStore } from './task.store';
import { TaskItem } from '../models/task-item';
import { readRuntimeConfig } from '../models/runtime-config';

const ALERT_INTERVAL_MS = 60_000;
const CHECK_INTERVAL_MS = 30_000;
type ExtendedNotificationOptions = NotificationOptions & {
  renotify?: boolean;
  requireInteraction?: boolean;
  actions?: Array<{ action: string; title: string; icon?: string }>;
};

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private initialized = false;
  private readonly runtimeConfig = readRuntimeConfig();
  private readonly permissionState = signal<'default' | 'granted' | 'denied'>(this.readPermission());

  readonly permission = this.permissionState.asReadonly();

  constructor(
    private readonly authStore: AuthStore,
    private readonly taskStore: TaskStore
  ) {}

  initialize(): void {
    if (this.initialized || !this.isBrowser()) {
      return;
    }
    this.initialized = true;
    this.registerServiceWorker();
    this.listenForServiceWorkerActions();
    this.applyActionFromUrl();
    if (!this.hasRemotePushConfig()) {
      window.setInterval(() => void this.schedulerTick(), CHECK_INTERVAL_MS);
      void this.schedulerTick();
    }
  }

  async requestPermission(): Promise<void> {
    if (!this.isBrowser() || !('Notification' in window)) {
      return;
    }
    await Notification.requestPermission();
    this.permissionState.set(Notification.permission);
  }

  private async schedulerTick(): Promise<void> {
    if (!this.authStore.isLoggedIn()) {
      return;
    }
    const now = new Date();
    for (const item of this.taskStore.items()) {
      if (!this.taskStore.isDueForAlert(item, now)) {
        continue;
      }
      if (this.taskStore.alertedWithin(item, now, ALERT_INTERVAL_MS)) {
        continue;
      }
      const wasSent = await this.sendNotification(item);
      if (!wasSent) {
        continue;
      }
      this.taskStore.markAlerted(item.id, now);
    }
  }

  private async sendNotification(item: TaskItem): Promise<boolean> {
    if (!this.isBrowser() || !('Notification' in window)) {
      return false;
    }
    if (Notification.permission !== 'granted') {
      return false;
    }

    const options: ExtendedNotificationOptions = {
      body: item.description || `Daily ${item.kind} due now (${item.schedule.time}).`,
      tag: `my-secretary-${item.id}`,
      renotify: true,
      requireInteraction: true,
      data: {
        taskId: item.id
      },
      actions: [
        { action: 'complete', title: 'Complete' },
        { action: 'snooze_5', title: 'Snooze 5m' },
        { action: 'snooze_10', title: 'Snooze 10m' },
        { action: 'snooze_30', title: 'Snooze 30m' }
      ]
    };

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(item.title, options);
        return true;
      }
    } catch {
      new Notification(item.title, options);
      return true;
    }
    new Notification(item.title, options);
    return true;
  }

  private async registerServiceWorker(): Promise<void> {
    if (!this.isBrowser() || !('serviceWorker' in navigator)) {
      return;
    }
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch {
      return;
    }
  }

  private listenForServiceWorkerActions(): void {
    if (!this.isBrowser() || !('serviceWorker' in navigator)) {
      return;
    }
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
      const payload = event.data as { type?: string; taskId?: string; action?: string };
      if (payload.type !== 'notification-action' || !payload.taskId || !payload.action) {
        return;
      }
      this.taskStore.applyNotificationAction(payload.taskId, payload.action);
    });
  }

  private applyActionFromUrl(): void {
    if (!this.isBrowser()) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const taskId = params.get('taskId');
    if (!action || !taskId) {
      return;
    }
    this.taskStore.applyNotificationAction(taskId, action);
    params.delete('action');
    params.delete('taskId');
    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    history.replaceState(null, '', nextUrl);
  }

  private readPermission(): 'default' | 'granted' | 'denied' {
    if (!this.isBrowser() || !('Notification' in window)) {
      return 'default';
    }
    return Notification.permission;
  }

  private isBrowser(): boolean {
    return typeof window !== 'undefined';
  }

  private hasRemotePushConfig(): boolean {
    return Boolean(this.runtimeConfig.apiBaseUrl);
  }
}
