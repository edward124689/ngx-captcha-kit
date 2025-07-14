import { Component, Input, Output, EventEmitter, AfterViewInit, ElementRef, OnDestroy } from '@angular/core';
import { CaptchaService } from './captcha.service';

type CaptchaType = 'recaptcha-v2' | 'recaptcha-v3' | 'turnstile' | 'alibaba';

@Component({
  standalone: false,
  selector: 'captcha-kit',
  template: `<div [id]="containerId" [class]="getClass()"></div>`,
})
export class CaptchaComponent implements AfterViewInit, OnDestroy {
  @Input() type: CaptchaType | undefined;
  @Input() siteKey?: string;
  @Input() sceneId?: string;
  @Input() prefix?: string; // 新增 for Alibaba
  @Input() region?: string = 'cn'; // 新增 for Alibaba, default 'cn'
  @Input() action?: string;
  @Input() theme?: 'light' | 'dark' | 'auto' = 'light';
  @Input() size?: 'normal' | 'compact' | 'invisible' = 'normal';
  @Input() mode?: 'embed' | 'popup' | 'float' = 'embed';
  @Input() cData?: string;
  @Input() language?: string = 'auto';
  @Output() resolved = new EventEmitter<string | any>();
  @Output() error = new EventEmitter<any>();

  containerId = 'captcha-container';
  private widgetId?: string | number;
  private isReady = false; // 用於 v3 ready 狀態

  constructor(private captchaService: CaptchaService, private el: ElementRef) {}

  async ngAfterViewInit() {
    if (!this.type) {
      console.log('Type is required');
      this.error.emit('Type is required');
      return;
    }

    try {
      switch (this.type) {
        case 'recaptcha-v2':
          await this.captchaService.loadScript('https://www.google.com/recaptcha/api.js?render=explicit&onload=ngRecaptchaOnload', 'ngRecaptchaOnload', this.language);
          this.widgetId = (window as any).grecaptcha.render(this.el.nativeElement.querySelector('div'), {
            sitekey: this.siteKey,
            theme: this.theme,
            size: this.size,
            callback: (token: string) => this.resolved.emit(token),
            'error-callback': (err: any) => this.error.emit(err),
          });
          break;
        case 'recaptcha-v3':
          await this.captchaService.loadScript(`https://www.google.com/recaptcha/api.js?render=${this.siteKey}`, undefined, this.language);
          await new Promise<void>(resolve => (window as any).grecaptcha.ready(resolve));
          this.isReady = true;
          break;

        case 'turnstile':
          const renderPromise = new Promise<void>((resolve, reject) => {
            (window as any).turnstileOnload = () => {
              try {
                this.widgetId = (window as any).turnstile.render(this.el.nativeElement.querySelector('div'), {
                  sitekey: this.siteKey,
                  action: this.action,
                  cData: this.cData,
                  theme: this.theme,
                  language: this.language,
                  callback: (token: string) => this.resolved.emit(token),
                  'error-callback': (err: any) => this.error.emit(err),
                });
                resolve();
              } catch (err) {
                reject(err);
              }
            };
          });
          await this.captchaService.loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?onload=turnstileOnload&render=explicit');
          await renderPromise;
          break;

        case 'alibaba':
          if (!this.sceneId || !this.prefix) {
            this.error.emit('SceneId and Prefix are required for Alibaba Captcha');
            return;
          }

          (window as any).AliyunCaptchaConfig = {
            region: this.region || 'cn',
            prefix: this.prefix,
          };

          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js';
            script.async = true;
            script.defer = true;
            script.onload = () => resolve();
            script.onerror = (err) => reject(err);
            document.body.appendChild(script);
          });

          if (typeof (window as any).initAliyunCaptcha !== 'function') {
            this.error.emit('AliyunCaptcha script loaded but initAliyunCaptcha not defined. Check console for errors.');
            return;
          }

          (window as any).initAliyunCaptcha({
            SceneId: this.sceneId,
            prefix: this.prefix,
            region: this.region,
            mode: this.mode,
            element: `#${this.containerId}`,
            captchaVerifyCallback: (param: any) => this.resolved.emit(param),
            language: this.language,
          });
          break;

        default:
          this.error.emit('Unsupported type');
      }
    } catch (err) {
      console.log(err);
      this.error.emit(err);
    }
  }

  // Public 方法給 v3 手動執行
  async execute(): Promise<string> {
    if (this.type !== 'recaptcha-v3' || !this.isReady) {
      throw new Error('reCAPTCHA v3 not ready or invalid type');
    }
    const token = await (window as any).grecaptcha.execute(this.siteKey, { action: this.action });
    this.resolved.emit(token);
    return token;
  }

  ngOnDestroy() {
    if (this.type === 'recaptcha-v2' && this.widgetId !== undefined) {
      (window as any).grecaptcha.reset(this.widgetId);
    } else if (this.type === 'turnstile' && this.widgetId !== undefined) {
      (window as any).turnstile.remove(this.widgetId);
    }
  }

  public getClass(): string {
    return this.type === 'turnstile' ? 'cf-turnstile' : this.type === 'recaptcha-v2' ? 'g-recaptcha' : '';
  }
}
