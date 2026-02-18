import { computed, Injectable, signal } from '@angular/core';
import { NewTaskInput, TaskItem, TaskStatus } from '../models/task-item';

const LEGACY_STORAGE_KEY = 'my-secretary-items';
const STORAGE_KEY_PREFIX = 'my-secretary-items:';
const CLOCK_TICK_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class TaskStore {
  private readonly itemsState = signal<TaskItem[]>([]);
  private readonly activeStorageKey = signal<string | null>(null);
  private readonly nowState = signal(new Date());

  readonly items = this.itemsState.asReadonly();
  readonly sortedItems = computed(() => {
    return [...this.itemsState()].sort((left, right) => {
      const leftDue = this.toDueDate(left.schedule.time, this.nowState()).getTime();
      const rightDue = this.toDueDate(right.schedule.time, this.nowState()).getTime();
      return leftDue - rightDue;
    });
  });

  constructor() {
    window.setInterval(() => this.nowState.set(new Date()), CLOCK_TICK_MS);
  }

  setActiveUser(userName: string | null): void {
    const normalizedUserName = userName?.trim().toLowerCase() ?? '';
    if (!normalizedUserName) {
      this.activeStorageKey.set(null);
      this.itemsState.set([]);
      return;
    }
    const nextStorageKey = `${STORAGE_KEY_PREFIX}${normalizedUserName}`;
    this.activeStorageKey.set(nextStorageKey);
    this.itemsState.set(this.readItems(nextStorageKey));
  }

  replaceItems(items: TaskItem[]): void {
    this.commit(this.normalizeIncomingItems(items));
  }

  ensureMvpTask(): void {
    if (!this.activeStorageKey()) {
      return;
    }
    const hasDailyCleaning = this.itemsState().some(
      (item) => item.kind === 'task' && item.title.toLowerCase() === 'daily cleaning'
    );
    if (hasDailyCleaning) {
      return;
    }
    this.addItem({
      kind: 'task',
      title: 'Daily cleaning',
      description: 'Tidy up and clear surfaces.',
      time: '18:00'
    });
  }

  addItem(input: NewTaskInput): void {
    const title = input.title.trim();
    if (!title || !this.isValidTime(input.time)) {
      return;
    }
    const item: TaskItem = {
      id: crypto.randomUUID(),
      kind: input.kind,
      title,
      description: input.description.trim(),
      schedule: {
        type: 'daily',
        time: input.time
      },
      state: {
        lastCompletedDate: null,
        snoozedUntil: null,
        lastAlertedAt: null
      }
    };
    this.commit([...this.itemsState(), item]);
  }

  completeItem(itemId: string): void {
    this.updateItem(itemId, (item) => ({
      ...item,
      state: {
        ...item.state,
        lastCompletedDate: this.toDayKey(new Date()),
        snoozedUntil: null,
        lastAlertedAt: null
      }
    }));
  }

  snoozeItem(itemId: string, minutes: number): void {
    const snoozedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
    this.updateItem(itemId, (item) => ({
      ...item,
      state: {
        ...item.state,
        snoozedUntil,
        lastAlertedAt: null
      }
    }));
  }

  deleteItem(itemId: string): void {
    this.commit(this.itemsState().filter((item) => item.id !== itemId));
  }

  applyNotificationAction(itemId: string, action: string): void {
    if (action === 'complete') {
      this.completeItem(itemId);
      return;
    }
    if (action === 'snooze_5') {
      this.snoozeItem(itemId, 5);
      return;
    }
    if (action === 'snooze_10') {
      this.snoozeItem(itemId, 10);
      return;
    }
    if (action === 'snooze_30') {
      this.snoozeItem(itemId, 30);
    }
  }

  getStatus(item: TaskItem): TaskStatus {
    const now = this.nowState();
    if (item.state.lastCompletedDate === this.toDayKey(now)) {
      return { kind: 'done', label: 'Completed today' };
    }
    const dueDate = this.toDueDate(item.schedule.time, now);
    const snoozeDate = item.state.snoozedUntil ? new Date(item.state.snoozedUntil) : null;
    if (snoozeDate && now.getTime() < snoozeDate.getTime()) {
      return { kind: 'snoozed', label: `Snoozed until ${this.toClockTime(snoozeDate)}` };
    }
    if (now.getTime() < dueDate.getTime()) {
      return { kind: 'pending', label: `Due ${this.toClockTime(dueDate)}` };
    }
    return { kind: 'overdue', label: 'Overdue: alerting every minute' };
  }

  isDueForAlert(item: TaskItem, now: Date): boolean {
    if (item.state.lastCompletedDate === this.toDayKey(now)) {
      return false;
    }
    const dueDate = this.toDueDate(item.schedule.time, now);
    if (now.getTime() < dueDate.getTime()) {
      return false;
    }
    const snoozedUntil = item.state.snoozedUntil ? new Date(item.state.snoozedUntil) : null;
    if (snoozedUntil && now.getTime() < snoozedUntil.getTime()) {
      return false;
    }
    return true;
  }

  alertedWithin(item: TaskItem, now: Date, intervalMs: number): boolean {
    if (!item.state.lastAlertedAt) {
      return false;
    }
    return now.getTime() - new Date(item.state.lastAlertedAt).getTime() < intervalMs;
  }

  markAlerted(itemId: string, when: Date): void {
    this.updateItem(itemId, (item) => ({
      ...item,
      state: {
        ...item.state,
        lastAlertedAt: when.toISOString()
      }
    }));
  }

  private updateItem(itemId: string, updater: (item: TaskItem) => TaskItem): void {
    const updatedItems = this.itemsState().map((item) => (item.id === itemId ? updater(item) : item));
    this.commit(updatedItems);
  }

  private commit(items: TaskItem[]): void {
    this.itemsState.set(items);
    const storageKey = this.activeStorageKey();
    if (storageKey) {
      localStorage.setItem(storageKey, JSON.stringify(items));
    }
  }

  private readItems(storageKey: string): TaskItem[] {
    const storedValue = localStorage.getItem(storageKey);
    if (!storedValue) {
      const legacyValue = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacyValue) {
        localStorage.setItem(storageKey, legacyValue);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }
    const resolvedValue = localStorage.getItem(storageKey);
    if (!resolvedValue) {
      return [];
    }
    try {
      const parsed = JSON.parse(resolvedValue) as TaskItem[];
      return this.normalizeIncomingItems(parsed);
    } catch {
      return [];
    }
  }

  private normalizeIncomingItems(items: TaskItem[]): TaskItem[] {
    if (!Array.isArray(items)) {
      return [];
    }
    return items
      .filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string')
      .map((item) => {
        const kind = item.kind === 'medication' ? 'medication' : 'task';
        return {
          id: item.id,
          kind,
          title: item.title.trim(),
          description: typeof item.description === 'string' ? item.description : '',
          schedule: {
            type: 'daily',
            time: typeof item.schedule?.time === 'string' ? item.schedule.time : '09:00'
          },
          state: {
            lastCompletedDate:
              typeof item.state?.lastCompletedDate === 'string' ? item.state.lastCompletedDate : null,
            snoozedUntil: typeof item.state?.snoozedUntil === 'string' ? item.state.snoozedUntil : null,
            lastAlertedAt: typeof item.state?.lastAlertedAt === 'string' ? item.state.lastAlertedAt : null
          }
        } as TaskItem;
      })
      .filter((item) => item.title.length > 0 && this.isValidTime(item.schedule.time));
  }

  private toDayKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`;
  }

  private toDueDate(time: string, now: Date): Date {
    const [hours, minutes] = time.split(':').map(Number);
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      Number.isFinite(hours) ? hours : 0,
      Number.isFinite(minutes) ? minutes : 0,
      0,
      0
    );
  }

  private toClockTime(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  private isValidTime(value: string): boolean {
    return /^\d{2}:\d{2}$/.test(value);
  }
}
