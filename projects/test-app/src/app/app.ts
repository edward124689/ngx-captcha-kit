import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {NgxCaptchaKitModule} from '../../../ngx-captcha-kit/src/lib/ngx-captcha-kit.module';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet,NgxCaptchaKitModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('test-app');
}
