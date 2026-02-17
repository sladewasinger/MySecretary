import { Component, effect } from '@angular/core';
import { LoginCardComponent } from './components/login-card.component';
import { TaskFormComponent } from './components/task-form.component';
import { TaskAction, TaskListComponent } from './components/task-list.component';
import { NewTaskInput, TaskItem, TaskStatus } from './models/task-item';
import { AuthStore } from './services/auth.store';
import { NotificationService } from './services/notification.service';
import { PushBackendService } from './services/push-backend.service';
import { TaskStore } from './services/task.store';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [LoginCardComponent, TaskFormComponent, TaskListComponent],
  template: `
    <main class="shell">
      @if (!authStore.isLoggedIn()) {
        <app-login-card (signIn)="login($event)"></app-login-card>
      } @else {
        <section>
          <header class="topbar">
            <div>
              <h1>My Secretary</h1>
              <p class="muted">Signed in as {{ authStore.session()?.name }}</p>
            </div>
            <button class="ghost" type="button" (click)="logout()">Log out</button>
          </header>

          <app-task-form (addItem)="addItem($event)"></app-task-form>

          <section class="card">
            <div class="controls">
              <button class="secondary" type="button" (click)="requestPermission()">
                Enable notifications
              </button>
              <span class="muted">Permission: {{ notificationService.permission() }}</span>
              <span class="muted">Push sync: {{ pushBackendService.state() }}</span>
            </div>
          </section>

          <app-task-list
            [items]="taskStore.sortedItems()"
            [statusFor]="statusFor"
            (action)="handleTaskAction($event)"
          ></app-task-list>
        </section>
      }
    </main>
  `
})
export class AppComponent {
  readonly statusFor = (item: TaskItem): TaskStatus => this.taskStore.getStatus(item);

  constructor(
    readonly authStore: AuthStore,
    readonly taskStore: TaskStore,
    readonly notificationService: NotificationService,
    readonly pushBackendService: PushBackendService
  ) {
    this.notificationService.initialize();
    effect(() => {
      if (this.authStore.isLoggedIn()) {
        this.taskStore.ensureMvpTask();
      }
    });
    effect(() => {
      const user = this.authStore.session();
      const permission = this.notificationService.permission();
      const tasks = this.taskStore.items();
      if (!user || permission !== 'granted') {
        return;
      }
      void this.pushBackendService.syncUserTasks(user.name, tasks);
    });
  }

  login(name: string): void {
    this.authStore.login(name);
  }

  logout(): void {
    this.authStore.logout();
  }

  addItem(input: NewTaskInput): void {
    this.taskStore.addItem(input);
  }

  handleTaskAction(action: TaskAction): void {
    if (action.type === 'complete') {
      this.taskStore.completeItem(action.itemId);
      return;
    }
    if (action.type === 'delete') {
      this.taskStore.deleteItem(action.itemId);
      return;
    }
    this.taskStore.snoozeItem(action.itemId, action.minutes);
  }

  async requestPermission(): Promise<void> {
    await this.notificationService.requestPermission();
  }
}
