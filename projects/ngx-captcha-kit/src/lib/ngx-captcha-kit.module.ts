import { NgModule } from '@angular/core';
import { CaptchaComponent } from './captcha.component';
import { CaptchaService } from './captcha.service';

@NgModule({
  declarations: [CaptchaComponent],
  exports: [CaptchaComponent],
  providers: [CaptchaService]
})
export class NgxCaptchaKitModule { }
