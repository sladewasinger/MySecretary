import { Component, effect, signal } from '@angular/core';
import { LoginCardComponent, LoginRequest } from './components/login-card.component';
import { TaskFormComponent } from './components/task-form.component';
import { TaskAction, TaskListComponent } from './components/task-list.component';
import { NewTaskInput, TaskItem, TaskStatus } from './models/task-item';
import { AuthStore, UserSession } from './services/auth.store';
import { BackendAuthService } from './services/backend-auth.service';
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
        <app-login-card
          [usesBackendAuth]="backendAuthService.usesBackendAuth()"
          (signIn)="login($event)"
        ></app-login-card>
        @if (backendAuthService.error()) {
          <section class="card">
            <p class="state-overdue">{{ backendAuthService.error() }}</p>
          </section>
        }
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

          <section class="card">
            <h2>Delivery Diagnostics</h2>
            <div class="diag-grid">
              <span class="muted">Backend auth mode</span>
              <span>{{ backendAuthService.usesBackendAuth() ? 'enabled' : 'local-only' }}</span>
              <span class="muted">Backend reachable</span>
              <span>{{ yesNo(pushBackendService.diagnostics().backendReachable) }}</span>
              <span class="muted">Push configured</span>
              <span>{{ yesNo(pushBackendService.diagnostics().pushConfigured) }}</span>
              <span class="muted">Registered devices</span>
              <span>{{ pushBackendService.diagnostics().deviceCount }}</span>
              <span class="muted">Backend tasks</span>
              <span>{{ pushBackendService.diagnostics().taskCount }}</span>
              <span class="muted">Last sync</span>
              <span>{{ formatTimestamp(pushBackendService.diagnostics().lastSyncAt) }}</span>
              <span class="muted">Last push success</span>
              <span>{{ formatTimestamp(pushBackendService.diagnostics().lastPushSuccessAt) }}</span>
              <span class="muted">Last push failure</span>
              <span>
                {{ formatTimestamp(pushBackendService.diagnostics().lastPushFailureAt) }}
                @if (pushBackendService.diagnostics().lastPushFailureMessage) {
                  - {{ pushBackendService.diagnostics().lastPushFailureMessage }}
                }
              </span>
              <span class="muted">Scheduler last run</span>
              <span>{{ formatTimestamp(pushBackendService.diagnostics().schedulerLastRunAt) }}</span>
            </div>
            <div class="actions">
              <button class="secondary" type="button" (click)="refreshDiagnostics()">Refresh diagnostics</button>
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
  private readonly hydratingUser = signal<string | null>(null);

  constructor(
    readonly authStore: AuthStore,
    readonly backendAuthService: BackendAuthService,
    readonly taskStore: TaskStore,
    readonly notificationService: NotificationService,
    readonly pushBackendService: PushBackendService
  ) {
    this.notificationService.initialize();

    effect(() => {
      const session = this.authStore.session();
      this.taskStore.setActiveUser(session?.name ?? null);
      if (!session) {
        this.hydratingUser.set(null);
        this.pushBackendService.clearSession();
        return;
      }
      this.hydratingUser.set(session.name);
      void this.hydrateSession(session);
    });

    effect(() => {
      const session = this.authStore.session();
      const activeHydration = this.hydratingUser();
      const tasks = this.taskStore.items();
      if (!session || activeHydration === session.name) {
        return;
      }
      void this.pushBackendService.syncUserTasks(session, tasks);
    });
  }

  async login(request: LoginRequest): Promise<void> {
    const session = await this.backendAuthService.authenticate(request);
    if (!session) {
      return;
    }
    this.authStore.setSession(session);
  }

  logout(): void {
    this.authStore.logout();
    this.backendAuthService.resetState();
    this.pushBackendService.clearSession();
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

  async refreshDiagnostics(): Promise<void> {
    const session = this.authStore.session();
    if (!session) {
      return;
    }
    await this.pushBackendService.refreshDiagnostics(session);
  }

  yesNo(value: boolean): string {
    return value ? 'yes' : 'no';
  }

  formatTimestamp(value: string | null): string {
    if (!value) {
      return 'n/a';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'n/a';
    }
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  }

  private async hydrateSession(session: UserSession): Promise<void> {
    try {
      const serverTasks = await this.pushBackendService.loadServerTasks(session);
      if (!this.isCurrentSession(session)) {
        return;
      }
      if (serverTasks) {
        this.taskStore.replaceItems(serverTasks);
      }
      if (this.taskStore.items().length === 0) {
        this.taskStore.ensureMvpTask();
      }
      await this.pushBackendService.refreshDiagnostics(session);
    } finally {
      if (this.isCurrentSession(session)) {
        this.hydratingUser.set(null);
      }
    }
  }

  private isCurrentSession(session: UserSession): boolean {
    return this.authStore.session()?.name === session.name && this.authStore.session()?.token === session.token;
  }
}
