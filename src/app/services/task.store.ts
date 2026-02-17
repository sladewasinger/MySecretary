import { computed, Injectable, signal } from '@angular/core';
import { NewTaskInput, TaskItem, TaskStatus } from '../models/task-item';

const STORAGE_KEY = 'my-secretary-items';
const CLOCK_TICK_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class TaskStore {
  private readonly itemsState = signal<TaskItem[]>(this.readItems());
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

  ensureMvpTask(): void {
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  private readItems(): TaskItem[] {
    const storedValue = localStorage.getItem(STORAGE_KEY);
    if (!storedValue) {
      return [];
    }
    try {
      const parsed = JSON.parse(storedValue) as TaskItem[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
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
