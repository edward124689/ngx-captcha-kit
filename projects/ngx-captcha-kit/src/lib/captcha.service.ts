import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, Inject, PLATFORM_ID } from '@angular/core';

export type AlibabaCaptchaMode = 'embed' | 'popup';

export interface AlibabaCaptchaVerifyResult {
  captchaResult: boolean;
  bizResult?: boolean;
}

export type AlibabaCaptchaVerifyCallback = (captchaVerifyParam: string) => AlibabaCaptchaVerifyResult | Promise<AlibabaCaptchaVerifyResult>;

export interface AlibabaCaptchaSlideStyle {
  width?: number;
  height?: number;
}

export interface AlibabaCaptchaOptions {
  mode?: AlibabaCaptchaMode;
  element: string;
  button: string;
  captchaVerifyCallback: AlibabaCaptchaVerifyCallback;
  onBizResultCallback?: (bizResult: boolean | undefined) => void;
  getInstance?: (instance: any) => void;
  language?: string;
  region?: string;
  prefix: string;
  slideStyle?: AlibabaCaptchaSlideStyle;
  immediate?: boolean;
  timeout?: number;
  rem?: number;
  autoRefresh?: boolean;
  captchaLogoImg?: string;
  onError?: (error: any) => void;
}

@Injectable({
  providedIn: 'root'
})
export class CaptchaService {
  private readyPromises = new Map<string, Promise<void>>();
  private nextContainerId = 0;

  constructor(
    @Inject(DOCUMENT) private doc: any,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  loadScript(url: string, onloadCallbackName?: string, language?: string, asyncLoad: boolean = true): Promise<void> {
    let modifiedUrl = url;
    if (language && url.includes('google.com/recaptcha')) {
      modifiedUrl += (url.includes('?') ? '&' : '?') + `hl=${language}`;
    }

    const existingPromise = this.readyPromises.get(modifiedUrl);
    if (existingPromise) return existingPromise;
    if (!isPlatformBrowser(this.platformId)) return Promise.resolve();

    const promise = new Promise<void>((resolve, reject) => {
      const resolveOnce = () => resolve();

      if (onloadCallbackName) {
        (window as any)[onloadCallbackName] = resolveOnce;
      }

      const script = this.doc.createElement('script');
      script.src = modifiedUrl;
      script.async = asyncLoad;
      script.defer = asyncLoad;
      script.onload = () => {
        if (!onloadCallbackName) {
          resolveOnce();
        }
      };
      script.onerror = (err: unknown) => {
        this.readyPromises.delete(modifiedUrl);
        reject(err);
      };
      this.doc.body.appendChild(script);
    });

    this.readyPromises.set(modifiedUrl, promise);
    return promise;
  }

  createContainerId(): string {
    return `captcha-container-${this.nextContainerId++}`;
  }

  async executeRecaptchaV3(siteKey: string, action: string, language?: string): Promise<string> {
    await this.loadScript(`https://www.google.com/recaptcha/api.js?render=${siteKey}`, undefined, language);
    await new Promise<void>(resolve => (window as any).grecaptcha.ready(resolve));
    return (window as any).grecaptcha.execute(siteKey, { action });
  }

  async executeTurnstile(siteKey: string, action?: string, cData?: string, element: string | HTMLElement = '#turnstile-container'): Promise<string> {
    await this.loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    const turnstile = (window as any).turnstile;
    if (!turnstile) {
      throw new Error('Turnstile script loaded but turnstile is not available');
    }
    if (typeof turnstile.ready === 'function') {
      await new Promise<void>(resolve => turnstile.ready(resolve));
    }
    return new Promise((resolve, reject) => {
      turnstile.render(element, {
        sitekey: siteKey,
        action: action,
        cData: cData,
        callback: (token: string) => resolve(token),
        'error-callback': (error: any) => reject(error),
      });
    });
  }

  async executeAlibabaCaptcha(sceneId: string, options: AlibabaCaptchaOptions): Promise<void> {
    const mode = options.mode || 'embed';
    if (mode !== 'embed' && mode !== 'popup') {
      throw new Error('Alibaba Captcha 2.0 supports only "embed" or "popup" mode');
    }

    (window as any).AliyunCaptchaConfig = {
      region: options.region || 'cn',
      prefix: options.prefix,
    };

    await this.loadScript('https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js');
    const initAliyunCaptcha = (window as any).initAliyunCaptcha;
    if (typeof initAliyunCaptcha !== 'function') {
      throw new Error('AliyunCaptcha script loaded but initAliyunCaptcha is not available');
    }

    initAliyunCaptcha({
      SceneId: sceneId,
      mode,
      element: options.element,
      button: options.button,
      captchaVerifyCallback: options.captchaVerifyCallback,
      onBizResultCallback: options.onBizResultCallback || (() => undefined),
      getInstance: options.getInstance || (() => undefined),
      language: this.normalizeAlibabaLanguage(options.language),
      slideStyle: options.slideStyle,
      immediate: options.immediate,
      timeout: options.timeout,
      rem: options.rem,
      autoRefresh: options.autoRefresh,
      onError: options.onError,
      captchaLogoImg: options.captchaLogoImg,
    });
  }

  private normalizeAlibabaLanguage(language: string | undefined): string {
    const normalized = (language || 'cn').toLowerCase();
    if (normalized === 'auto' || normalized === 'zh' || normalized === 'zh-cn' || normalized === 'cn') {
      return 'cn';
    }
    if (normalized === 'zh-tw' || normalized === 'zh-hk' || normalized === 'tw') {
      return 'tw';
    }
    if (normalized === 'en' || normalized.startsWith('en-')) {
      return 'en';
    }
    return language || 'cn';
  }
}
