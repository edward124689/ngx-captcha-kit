import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DOCUMENT } from '@angular/common';

@Injectable({
  providedIn: 'root'
})
export class CaptchaService {
  private scriptLoaded = new Map<string, boolean>();
  private readyPromises = new Map<string, Promise<void>>();

  constructor(
    @Inject(DOCUMENT) private doc: any,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  loadScript(url: string, onloadCallbackName?: string, language?: string, asyncLoad: boolean = true): Promise<void> | undefined {
    let modifiedUrl = url;
    if (language && url.includes('google.com/recaptcha')) {
      modifiedUrl += (url.includes('?') ? '&' : '?') + `hl=${language}`;
    }
    if (this.scriptLoaded.get(modifiedUrl)) return this.readyPromises.get(modifiedUrl);
    if (!isPlatformBrowser(this.platformId)) return Promise.resolve();

    const promise = new Promise<void>((resolve) => {
      if (onloadCallbackName) {
        (window as any)[onloadCallbackName] = () => resolve();
      } else {
        resolve();
      }
    });
    this.readyPromises.set(modifiedUrl, promise);

    const script = this.doc.createElement('script');
    script.src = modifiedUrl;
    script.async = asyncLoad;
    script.defer = asyncLoad;
    script.onload = () => {
      this.scriptLoaded.set(modifiedUrl, true);
      if (!onloadCallbackName) promise.then(() => {});
    };
    this.doc.body.appendChild(script);
    return promise;
  }

  async executeRecaptchaV3(siteKey: string, action: string, language?: string): Promise<string> {
    await this.loadScript(`https://www.google.com/recaptcha/api.js?render=${siteKey}`, undefined, language);
    await new Promise<void>(resolve => (window as any).grecaptcha.ready(resolve));
    return (window as any).grecaptcha.execute(siteKey, { action });
  }

  async executeTurnstile(siteKey: string, action?: string, cData?: string): Promise<string> {
    await this.loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    await (window as any).turnstile.ready();
    return new Promise((resolve, reject) => {
      (window as any).turnstile.render('#turnstile-container', {
        sitekey: siteKey,
        action: action,
        cData: cData,
        callback: (token: string) => resolve(token),
        'error-callback': (error: any) => reject(error),
      });
    });
  }

  async executeAlibabaCaptcha(sceneId: string | undefined, options: { mode: 'embed' | 'popup' | 'float' | undefined, element: string, captchaVerifyCallback: (param: any) => void, language?: string }) {
    await this.loadScript('https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js');
    (window as any).initAliyunCaptcha({
      SceneId: sceneId,
      mode: options.mode,
      element: options.element,
      captchaVerifyCallback: options.captchaVerifyCallback,
      language: options.language || 'zh',
      // 其他選項
    });
  }
}
