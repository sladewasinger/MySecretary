import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TaskItem, TaskStatus } from '../models/task-item';

export type TaskAction =
  | { type: 'complete'; itemId: string }
  | { type: 'snooze'; itemId: string; minutes: number }
  | { type: 'delete'; itemId: string };

@Component({
  selector: 'app-task-list',
  standalone: true,
  template: `
    <section class="card">
      <h2>Active Items</h2>
      <ul class="task-list">
        @if (!items.length) {
          <li class="muted">No items yet.</li>
        } @else {
          @for (item of items; track item.id) {
            <li class="task-item">
              <div>
                <strong>{{ item.title }}</strong>
                <span class="pill">{{ item.kind }}</span>
              </div>
              <div>{{ item.description || '(No description)' }}</div>
              <div class="task-meta">
                <span>Daily at {{ item.schedule.time }}</span>
                <span [class.state-overdue]="statusFor(item).kind === 'overdue'">{{ statusFor(item).label }}</span>
              </div>
              <div class="actions">
                <button type="button" (click)="complete(item.id)">Complete</button>
                <button type="button" (click)="snooze(item.id, 5)">Snooze 5m</button>
                <button type="button" (click)="snooze(item.id, 10)">Snooze 10m</button>
                <button type="button" (click)="snooze(item.id, 30)">Snooze 30m</button>
                <button type="button" class="secondary" (click)="remove(item.id)">Delete</button>
              </div>
            </li>
          }
        }
      </ul>
    </section>
  `
})
export class TaskListComponent {
  @Input({ required: true }) items: TaskItem[] = [];
  @Input({ required: true }) statusFor: (item: TaskItem) => TaskStatus = () => ({
    kind: 'pending',
    label: ''
  });

  @Output() readonly action = new EventEmitter<TaskAction>();

  complete(itemId: string): void {
    this.action.emit({ type: 'complete', itemId });
  }

  snooze(itemId: string, minutes: number): void {
    this.action.emit({ type: 'snooze', itemId, minutes });
  }

  remove(itemId: string): void {
    this.action.emit({ type: 'delete', itemId });
  }
}
