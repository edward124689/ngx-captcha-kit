import { isPlatformBrowser } from '@angular/common';
import { Component, Input, Output, EventEmitter, AfterViewInit, ElementRef, OnDestroy, ViewChild, Inject, PLATFORM_ID } from '@angular/core';
import { CaptchaService } from './captcha.service';

type CaptchaType = 'recaptcha-v2' | 'recaptcha-v3' | 'turnstile' | 'alibaba';

type InvisibleV2Execution = {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
};

@Component({
  standalone: false,
  selector: 'captcha-kit',
  template: `<div #container [id]="containerId" [class]="getClass()"></div>`,
})
export class CaptchaComponent implements AfterViewInit, OnDestroy {
  @Input() type: CaptchaType | undefined;
  @Input() siteKey?: string;
  @Input() sceneId?: string;
  @Input() prefix?: string;
  @Input() region?: string = 'cn';
  @Input() action?: string;
  @Input() theme?: 'light' | 'dark' | 'auto' = 'light';
  @Input() size?: 'normal' | 'compact' | 'invisible' = 'normal';
  @Input() mode?: 'embed' | 'popup' | 'float' = 'embed';
  @Input() cData?: string;
  @Input() language?: string = 'auto';
  @Output() resolved = new EventEmitter<string | any>();
  @Output() error = new EventEmitter<any>();

  @ViewChild('container', { static: true }) private containerRef?: ElementRef<HTMLElement>;

  containerId: string;
  private widgetId?: string | number;
  private isReady = false;
  private destroyed = false;
  private pendingInvisibleV2Execution?: InvisibleV2Execution;

  constructor(
    private captchaService: CaptchaService,
    private el: ElementRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.containerId = this.captchaService.createContainerId();
  }

  async ngAfterViewInit() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (!this.type) {
      this.emitError('Type is required');
      return;
    }

    if (this.requiresSiteKey(this.type) && !this.siteKey) {
      this.emitError(`siteKey is required for ${this.type}`);
      return;
    }

    try {
      switch (this.type) {
        case 'recaptcha-v2':
          await this.captchaService.loadScript('https://www.google.com/recaptcha/api.js?render=explicit', undefined, this.language);
          if (this.destroyed) return;
          this.widgetId = this.getRecaptcha().render(this.getContainerElement(), {
            sitekey: this.siteKey,
            theme: this.theme,
            size: this.size,
            callback: (token: string) => this.emitResolved(token),
            'error-callback': (err: any) => this.emitError(err),
            'expired-callback': () => this.emitError(new Error('reCAPTCHA challenge expired')),
          });
          break;

        case 'recaptcha-v3':
          await this.captchaService.loadScript(`https://www.google.com/recaptcha/api.js?render=${this.siteKey}`, undefined, this.language);
          if (this.destroyed) return;
          await new Promise<void>(resolve => this.getRecaptcha().ready(resolve));
          if (this.destroyed) return;
          this.isReady = true;
          break;

        case 'turnstile':
          await this.captchaService.loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
          if (this.destroyed) return;
          await this.waitForTurnstileReady();
          if (this.destroyed) return;
          this.widgetId = this.getTurnstile().render(this.getContainerElement(), {
            sitekey: this.siteKey,
            action: this.action,
            cData: this.cData,
            theme: this.theme,
            language: this.language,
            callback: (token: string) => this.emitResolved(token),
            'error-callback': (err: any) => this.emitError(err),
          });
          break;

        case 'alibaba':
          if (!this.sceneId || !this.prefix) {
            this.emitError('SceneId and Prefix are required for Alibaba Captcha');
            return;
          }

          (window as any).AliyunCaptchaConfig = {
            region: this.region || 'cn',
            prefix: this.prefix,
          };

          await this.captchaService.loadScript('https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js');
          if (this.destroyed) return;

          if (typeof (window as any).initAliyunCaptcha !== 'function') {
            this.emitError('AliyunCaptcha script loaded but initAliyunCaptcha not defined. Check console for errors.');
            return;
          }

          (window as any).initAliyunCaptcha({
            SceneId: this.sceneId,
            prefix: this.prefix,
            region: this.region,
            mode: this.mode,
            element: `#${this.containerId}`,
            captchaVerifyCallback: (param: any) => this.emitResolved(param),
            language: this.language,
          });
          break;

        default:
          this.emitError('Unsupported type');
      }
    } catch (err) {
      this.emitError(err);
    }
  }

  async execute(): Promise<string> {
    if (this.type === 'recaptcha-v3') {
      if (!this.isReady || !this.siteKey) {
        throw new Error('reCAPTCHA v3 not ready or missing siteKey');
      }
      const token = await this.getRecaptcha().execute(this.siteKey, { action: this.action });
      this.emitResolved(token);
      return token;
    }

    if (this.type === 'recaptcha-v2') {
      return this.executeInvisibleRecaptchaV2();
    }

    throw new Error('execute() is only supported for reCAPTCHA v2 invisible and reCAPTCHA v3');
  }

  ngOnDestroy() {
    this.destroyed = true;

    if (this.pendingInvisibleV2Execution) {
      this.pendingInvisibleV2Execution.reject(new Error('Captcha component destroyed before execution completed'));
      this.pendingInvisibleV2Execution = undefined;
    }

    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (this.type === 'recaptcha-v2' && this.widgetId !== undefined && (window as any).grecaptcha?.reset) {
      (window as any).grecaptcha.reset(this.widgetId);
    } else if (this.type === 'turnstile' && this.widgetId !== undefined && (window as any).turnstile?.remove) {
      (window as any).turnstile.remove(this.widgetId);
    }
  }

  public getClass(): string {
    return this.type === 'turnstile' ? 'cf-turnstile' : this.type === 'recaptcha-v2' ? 'g-recaptcha' : '';
  }

  private requiresSiteKey(type: CaptchaType): boolean {
    return type === 'recaptcha-v2' || type === 'recaptcha-v3' || type === 'turnstile';
  }

  private getContainerElement(): HTMLElement {
    return this.containerRef?.nativeElement ?? this.el.nativeElement.querySelector('div');
  }

  private getRecaptcha(): any {
    const recaptcha = (window as any).grecaptcha;
    if (!recaptcha) {
      throw new Error('reCAPTCHA script loaded but grecaptcha is not available');
    }
    return recaptcha;
  }

  private getTurnstile(): any {
    const turnstile = (window as any).turnstile;
    if (!turnstile) {
      throw new Error('Turnstile script loaded but turnstile is not available');
    }
    return turnstile;
  }

  private async waitForTurnstileReady(): Promise<void> {
    const turnstile = this.getTurnstile();
    if (typeof turnstile.ready === 'function') {
      await new Promise<void>(resolve => turnstile.ready(resolve));
    }
  }

  private executeInvisibleRecaptchaV2(): Promise<string> {
    if (this.size !== 'invisible') {
      throw new Error('reCAPTCHA v2 execute() requires size="invisible"');
    }
    if (this.widgetId === undefined) {
      throw new Error('reCAPTCHA v2 not ready');
    }
    if (this.pendingInvisibleV2Execution) {
      throw new Error('reCAPTCHA v2 execution already in progress');
    }

    const recaptcha = this.getRecaptcha();
    if (typeof recaptcha.execute !== 'function') {
      throw new Error('reCAPTCHA v2 execute API is not available');
    }

    return new Promise<string>((resolve, reject) => {
      this.pendingInvisibleV2Execution = { resolve, reject };
      try {
        const result = recaptcha.execute(this.widgetId);
        if (result && typeof result.then === 'function') {
          result.then((token: string) => this.emitResolved(token), (err: unknown) => this.emitError(err));
        }
      } catch (err) {
        this.pendingInvisibleV2Execution = undefined;
        reject(err);
      }
    });
  }

  private emitResolved(value: any): void {
    if (this.destroyed) return;

    this.resolved.emit(value);
    if (this.pendingInvisibleV2Execution) {
      this.pendingInvisibleV2Execution.resolve(value);
      this.pendingInvisibleV2Execution = undefined;
    }
  }

  private emitError(err: any): void {
    if (!this.destroyed) {
      this.error.emit(err);
    }
    if (this.pendingInvisibleV2Execution) {
      this.pendingInvisibleV2Execution.reject(err);
      this.pendingInvisibleV2Execution = undefined;
    }
  }
}
