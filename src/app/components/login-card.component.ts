import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface LoginRequest {
  userName: string;
  password: string;
  mode: 'login' | 'register';
}

@Component({
  selector: 'app-login-card',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="card">
      <h1>My Secretary</h1>
      <p class="muted">
        {{ usesBackendAuth ? 'Sign in or create an account for your task canvas.' : 'Enter your name to continue.' }}
      </p>
      <form (ngSubmit)="submit('login')">
        <label for="user-name">Username</label>
        <input
          id="user-name"
          name="user-name"
          type="text"
          required
          maxlength="40"
          [(ngModel)]="userName"
        />
        @if (usesBackendAuth) {
          <label for="password">Password</label>
          <input id="password" name="password" type="password" required minlength="8" [(ngModel)]="password" />
        }
        <div class="actions">
          @if (usesBackendAuth) {
            <button type="button" class="secondary" (click)="submit('register')">Create account</button>
          }
          <button type="submit">Sign in</button>
        </div>
      </form>
    </section>
  `
})
export class LoginCardComponent {
  @Input() usesBackendAuth = true;

  userName = '';
  password = '';

  @Output() readonly signIn = new EventEmitter<LoginRequest>();

  submit(mode: 'login' | 'register'): void {
    const userName = this.userName.trim();
    if (!userName || (this.usesBackendAuth && !this.password)) {
      return;
    }
    this.signIn.emit({
      userName,
      password: this.password,
      mode
    });
    this.password = '';
  }
}
