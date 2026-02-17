import { Component, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NewTaskInput, TaskKind } from '../models/task-item';

@Component({
  selector: 'app-task-form',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="card">
      <h2>Task Canvas</h2>
      <p class="muted">
        Add repeating daily work. Alerts keep firing every minute after due time until you complete or snooze.
      </p>
      <form class="grid" (ngSubmit)="submit()">
        <div>
          <label for="task-title">Title</label>
          <input id="task-title" name="task-title" type="text" required maxlength="80" [(ngModel)]="title" />
        </div>
        <div>
          <label for="task-time">Daily time</label>
          <input id="task-time" name="task-time" type="time" required [(ngModel)]="time" />
        </div>
        <div class="full">
          <label for="task-description">Description</label>
          <textarea
            id="task-description"
            name="task-description"
            rows="3"
            maxlength="240"
            [(ngModel)]="description"
          ></textarea>
        </div>
        <div>
          <label for="task-kind">Kind</label>
          <select id="task-kind" name="task-kind" [(ngModel)]="kind">
            <option value="task">Task</option>
            <option value="medication">Medication</option>
          </select>
        </div>
        <div class="full">
          <button type="submit">Add Daily Item</button>
        </div>
      </form>
    </section>
  `
})
export class TaskFormComponent {
  title = 'Daily cleaning';
  description = '';
  time = this.defaultTime();
  kind: TaskKind = 'task';

  @Output() readonly addItem = new EventEmitter<NewTaskInput>();

  submit(): void {
    if (!this.title.trim() || !this.time) {
      return;
    }
    this.addItem.emit({
      kind: this.kind,
      title: this.title,
      description: this.description,
      time: this.time
    });
    this.title = 'Daily cleaning';
    this.description = '';
    this.kind = 'task';
    this.time = this.defaultTime();
  }

  private defaultTime(): string {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 1);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
}
