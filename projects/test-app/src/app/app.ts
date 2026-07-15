import { Component, signal } from '@angular/core';
import { NgxCaptchaKitModule } from 'ngx-captcha-kit';

@Component({
  selector: 'app-root',
  imports: [NgxCaptchaKitModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  readonly token = signal('');
  readonly errorMessage = signal('');

  onResolved(token: string): void {
    this.token.set(token);
    this.errorMessage.set('');
  }

  onError(error: unknown): void {
    this.errorMessage.set(error instanceof Error ? error.message : String(error));
  }
}
