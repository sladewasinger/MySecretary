import { Component, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-login-card',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="card">
      <h1>My Secretary</h1>
      <p class="muted">Sign in to your task canvas.</p>
      <form (ngSubmit)="submit()">
        <label for="display-name">Display name</label>
        <input
          id="display-name"
          name="display-name"
          type="text"
          required
          maxlength="40"
          [(ngModel)]="displayName"
        />
        <button type="submit">Enter</button>
      </form>
    </section>
  `
})
export class LoginCardComponent {
  displayName = '';

  @Output() readonly signIn = new EventEmitter<string>();

  submit(): void {
    const name = this.displayName.trim();
    if (!name) {
      return;
    }
    this.signIn.emit(name);
  }
}
