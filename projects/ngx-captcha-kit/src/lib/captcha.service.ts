import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, Inject, OnDestroy, PLATFORM_ID } from '@angular/core';

export type AlibabaCaptchaMode = 'embed' | 'popup';
export type AlibabaCaptchaRegion = 'cn' | 'sgp';

export interface AlibabaCaptchaVerifyResult {
  captchaResult: boolean;
  bizResult?: boolean;
}

export type AlibabaCaptchaVerifyCallback = (captchaVerifyParam: string) => AlibabaCaptchaVerifyResult | Promise<AlibabaCaptchaVerifyResult>;

export interface AlibabaCaptchaInstance {
  refresh?: () => void;
  destroyCaptcha?: () => void;
  [key: string]: unknown;
}

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

export interface RecaptchaApi {
  ready(callback: () => void): void;
  render(element: string | HTMLElement, options: Record<string, unknown>): number;
  execute(siteKeyOrWidgetId: string | number, options?: { action?: string }): PromiseLike<string> | void;
  reset?(widgetId?: string | number): void;
}

export interface TurnstileApi {
  ready?(callback: () => void): void;
  render(element: string | HTMLElement, options: Record<string, unknown>): string | number;
  execute(elementOrWidgetId: string | HTMLElement | number): void;
  reset?(widgetId: string | number): void;
  remove?(widgetId: string | number): void;
}

interface CaptchaWindow extends Window {
  grecaptcha?: RecaptchaApi;
  turnstile?: TurnstileApi;
  AliyunCaptchaConfig?: {
    region: AlibabaCaptchaRegion;
    prefix: string;
  };
  initAliyunCaptcha?: (options: Record<string, unknown>) => void;
}

interface ScriptLoadEntry {
  promise: Promise<void>;
  configuration?: string;
  callbackName?: string;
  pending: boolean;
}

interface RecaptchaV3Widget {
  container: HTMLElement;
  widgetId: number;
  recaptcha: RecaptchaApi;
}

@Injectable({
  providedIn: 'root'
})
export class CaptchaService implements OnDestroy {
  private static readonly SCRIPT_LOAD_TIMEOUT_MS = 15000;
  private static callbackOwners = new WeakMap<Window, Map<string, symbol>>();
  private static failedScripts = new WeakSet<HTMLScriptElement>();
  private static alibabaConfigurations = new WeakMap<Window, Readonly<{ region: AlibabaCaptchaRegion; prefix: string }>>();

  private readyPromises = new Map<string, ScriptLoadEntry>();
  private recaptchaV3Widgets = new Map<string, RecaptchaV3Widget>();
  private nextContainerId = 0;
  private doc: Document;

  constructor(
    @Inject(DOCUMENT) doc: any,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.doc = doc as Document;
  }

  loadScript(url: string, onloadCallbackName?: string, language?: string, asyncLoad: boolean = true): Promise<void> {
    let modifiedUrl = url;
    if (language && language.toLowerCase() !== 'auto' && url.includes('google.com/recaptcha')) {
      const parsedUrl = new URL(url, this.doc.baseURI || 'https://localhost/');
      parsedUrl.searchParams.set('hl', language);
      modifiedUrl = parsedUrl.toString();
    }

    if (!isPlatformBrowser(this.platformId)) return Promise.resolve();

    const scriptKey = this.getScriptKey(modifiedUrl);
    const configuration = this.getScriptConfiguration(modifiedUrl, scriptKey);
    const existingEntry = this.readyPromises.get(scriptKey);
    if (existingEntry) {
      if (!this.isCompatibleConfiguration(existingEntry.configuration, configuration)) {
        return this.incompatibleConfiguration(scriptKey, existingEntry.configuration, configuration);
      }
      if (existingEntry.pending && onloadCallbackName && existingEntry.callbackName !== onloadCallbackName) {
        return Promise.reject(new Error(
          `${scriptKey} is already loading with callback="${existingEntry.callbackName || 'none'}"; `
          + `cannot request callback="${onloadCallbackName}"`,
        ));
      }
      return existingEntry.promise;
    }

    const existingScript = this.findExistingScript(modifiedUrl, scriptKey);
    if (existingScript) {
      const existingUrl = existingScript.getAttribute('src') || existingScript.src;
      const existingConfiguration = this.getScriptConfiguration(existingUrl, scriptKey);
      if (!this.isCompatibleConfiguration(existingConfiguration, configuration)) {
        return this.incompatibleConfiguration(scriptKey, existingConfiguration, configuration);
      }
      const alreadyLoaded = this.isExistingScriptLoaded(existingScript, scriptKey);
      const promise = this.waitForExistingScript(existingScript, scriptKey, onloadCallbackName).catch(error => {
        this.readyPromises.delete(scriptKey);
        throw error;
      });
      return this.cacheScriptLoad(
        scriptKey,
        promise,
        configuration,
        onloadCallbackName,
        !alreadyLoaded,
      );
    }

    if (this.isProviderAvailable(scriptKey)) {
      const promise = Promise.resolve();
      return this.cacheScriptLoad(scriptKey, promise, configuration, onloadCallbackName, false);
    }

    const host = this.doc.head || this.doc.body || this.doc.documentElement;
    if (!host) {
      return Promise.reject(new Error('Unable to find a document host for the CAPTCHA script'));
    }

    const browserWindow = this.getBrowserWindow('CAPTCHA script loading');
    let cleanupCallback: () => void = () => undefined;

    const promise = new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const script = this.doc.createElement('script');

      const cleanup = () => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        cleanupCallback();
        script.onload = null;
        script.onerror = null;
      };

      const markLoaded = () => {
        if (script.dataset) {
          delete script.dataset['ngxCaptchaKitLoading'];
          script.dataset['ngxCaptchaKitLoaded'] = 'true';
        }
      };

      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        markLoaded();
        cleanup();
        resolve();
      };

      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        CaptchaService.failedScripts.add(script);
        if (script.dataset) {
          delete script.dataset['ngxCaptchaKitLoading'];
        }
        script.remove?.();
        reject(error);
      };

      if (onloadCallbackName) {
        try {
          const cleanup = this.installCallback(browserWindow, onloadCallbackName, resolveOnce);
          if (!cleanup) {
            reject(new Error(`CAPTCHA script callback "${onloadCallbackName}" is already in use`));
            return;
          }
          cleanupCallback = cleanup;
        } catch (error) {
          reject(error);
          return;
        }
      }

      script.src = modifiedUrl;
      script.async = asyncLoad;
      script.defer = asyncLoad;
      if (script.dataset) {
        script.dataset['ngxCaptchaKitLoading'] = 'true';
      }
      script.onload = resolveOnce;
      script.onerror = rejectOnce;

      timeoutId = setTimeout(() => {
        rejectOnce(new Error(`Timed out loading CAPTCHA script: ${script.src}`));
      }, CaptchaService.SCRIPT_LOAD_TIMEOUT_MS);

      try {
        host.appendChild(script);
      } catch (error) {
        rejectOnce(error);
      }
    });

    const trackedPromise = promise.catch(error => {
      this.readyPromises.delete(scriptKey);
      cleanupCallback();
      throw error;
    });
    return this.cacheScriptLoad(
      scriptKey,
      trackedPromise,
      configuration,
      onloadCallbackName,
      true,
    );
  }

  createContainerId(): string {
    return `captcha-container-${this.nextContainerId++}`;
  }

  ngOnDestroy(): void {
    for (const widget of this.recaptchaV3Widgets.values()) {
      widget.recaptcha.reset?.(widget.widgetId);
      widget.container.remove();
    }
    this.recaptchaV3Widgets.clear();
  }

  async executeRecaptchaV3(siteKey: string, action: string, language?: string): Promise<string> {
    const browserWindow = this.getBrowserWindow('reCAPTCHA v3');
    await this.loadScript('https://www.google.com/recaptcha/api.js?render=explicit', undefined, language);
    const recaptcha = browserWindow.grecaptcha;
    if (!recaptcha) {
      throw new Error('reCAPTCHA script loaded but grecaptcha is not available');
    }
    await new Promise<void>(resolve => recaptcha.ready(resolve));

    const widget = this.getOrCreateRecaptchaV3Widget(siteKey, recaptcha);
    const result = recaptcha.execute(widget.widgetId, { action });
    if (!result) {
      throw new Error('reCAPTCHA v3 execute did not return a token promise');
    }
    return Promise.resolve(result);
  }

  async executeTurnstile(siteKey: string, action?: string, cData?: string, element: string | HTMLElement = '#turnstile-container'): Promise<string> {
    const browserWindow = this.getBrowserWindow('Turnstile');
    await this.loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    const turnstile = browserWindow.turnstile;
    if (!turnstile) {
      throw new Error('Turnstile script loaded but turnstile is not available');
    }
    const ready = turnstile.ready;
    if (typeof ready === 'function') {
      await new Promise<void>(resolve => ready.call(turnstile, resolve));
    }
    return new Promise((resolve, reject) => {
      let widgetId: string | number | undefined;
      let cleanupRequested = false;
      let settled = false;

      const cleanup = () => {
        if (widgetId === undefined) {
          cleanupRequested = true;
          return;
        }
        try {
          turnstile.remove?.(widgetId);
        } catch {
          // Token delivery should not fail because provider cleanup failed.
        }
      };
      const resolveOnce = (token: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(token);
      };
      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      try {
        widgetId = turnstile.render(element, {
          sitekey: siteKey,
          action: action,
          cData: cData,
          callback: (token: string) => resolveOnce(token),
          'error-callback': (error: unknown) => {
            rejectOnce(error);
            return true;
          },
          'expired-callback': () => rejectOnce(new Error('Turnstile token expired')),
          'timeout-callback': () => rejectOnce(new Error('Turnstile challenge timed out')),
        });
        if (cleanupRequested) cleanup();
      } catch (error) {
        rejectOnce(error);
      }
    });
  }

  async executeAlibabaCaptcha(sceneId: string, options: AlibabaCaptchaOptions): Promise<void> {
    const browserWindow = this.getBrowserWindow('Alibaba Captcha 2.0');
    const mode = options.mode || 'embed';
    if (mode !== 'embed' && mode !== 'popup') {
      throw new Error('Alibaba Captcha 2.0 supports only "embed" or "popup" mode');
    }

    const region = options.region ?? 'cn';
    if (region !== 'cn' && region !== 'sgp') {
      throw new Error('Alibaba Captcha 2.0 region must be "cn" or "sgp"');
    }

    await this.loadAlibabaScript(region, options.prefix);
    const initAliyunCaptcha = browserWindow.initAliyunCaptcha;
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

  async loadAlibabaScript(region: AlibabaCaptchaRegion, prefix: string): Promise<void> {
    if (region !== 'cn' && region !== 'sgp') {
      throw new Error('Alibaba Captcha 2.0 region must be "cn" or "sgp"');
    }
    if (!prefix) {
      throw new Error('Alibaba Captcha 2.0 prefix is required');
    }

    const browserWindow = this.getBrowserWindow('Alibaba Captcha 2.0');
    let trackedConfiguration = CaptchaService.alibabaConfigurations.get(browserWindow);
    const globalConfiguration = browserWindow.AliyunCaptchaConfig;
    const providerAvailable = typeof browserWindow.initAliyunCaptcha === 'function';

    if (trackedConfiguration && !globalConfiguration && !providerAvailable) {
      CaptchaService.alibabaConfigurations.delete(browserWindow);
      trackedConfiguration = undefined;
    }

    if (trackedConfiguration && globalConfiguration
      && !this.isSameAlibabaConfiguration(trackedConfiguration, globalConfiguration)) {
      throw new Error('Alibaba CAPTCHA global configuration changed after the SDK was configured');
    }

    const currentConfiguration = trackedConfiguration || globalConfiguration;
    const requestedConfiguration = { region, prefix };
    if (currentConfiguration && !this.isSameAlibabaConfiguration(currentConfiguration, requestedConfiguration)) {
      throw new Error(
        `Alibaba CAPTCHA SDK is already configured with region="${currentConfiguration.region}" `
        + `and prefix="${currentConfiguration.prefix}"; cannot request region="${region}" and prefix="${prefix}"`,
      );
    }

    const ownsConfiguration = !currentConfiguration;
    CaptchaService.alibabaConfigurations.set(browserWindow, Object.freeze({ ...requestedConfiguration }));
    browserWindow.AliyunCaptchaConfig = { ...requestedConfiguration };

    try {
      await this.loadScript('https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js');
    } catch (error) {
      if (ownsConfiguration && typeof browserWindow.initAliyunCaptcha !== 'function') {
        CaptchaService.alibabaConfigurations.delete(browserWindow);
        if (browserWindow.AliyunCaptchaConfig
          && this.isSameAlibabaConfiguration(browserWindow.AliyunCaptchaConfig, requestedConfiguration)) {
          delete browserWindow.AliyunCaptchaConfig;
        }
      }
      throw error;
    }
  }

  private isSameAlibabaConfiguration(
    current: { region: AlibabaCaptchaRegion; prefix: string },
    requested: { region: AlibabaCaptchaRegion; prefix: string },
  ): boolean {
    return current.region === requested.region && current.prefix === requested.prefix;
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

  private getBrowserWindow(provider: string): CaptchaWindow {
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error(`${provider} execution is only available in a browser`);
    }
    return (this.doc.defaultView || window) as CaptchaWindow;
  }

  private getScriptKey(url: string): string {
    if (url.includes('google.com/recaptcha/api.js')) return 'google-recaptcha';
    if (url.includes('challenges.cloudflare.com/turnstile/')) return 'cloudflare-turnstile';
    if (url.includes('o.alicdn.com/captcha-frontend/')) return 'alibaba-captcha';
    return url;
  }

  private isGoogleScriptKey(scriptKey: string): boolean {
    return scriptKey === 'google-recaptcha';
  }

  private isTurnstileScriptKey(scriptKey: string): boolean {
    return scriptKey === 'cloudflare-turnstile';
  }

  private isProviderScriptKey(scriptKey: string): boolean {
    return this.isGoogleScriptKey(scriptKey)
      || scriptKey === 'cloudflare-turnstile'
      || scriptKey === 'alibaba-captcha';
  }

  private getScriptConfiguration(url: string, scriptKey: string): string | undefined {
    if (!this.isGoogleScriptKey(scriptKey) && !this.isTurnstileScriptKey(scriptKey)) return undefined;
    const parsedUrl = new URL(url, this.doc.baseURI || 'https://localhost/');
    if (this.isTurnstileScriptKey(scriptKey)) {
      return parsedUrl.searchParams.get('render') || 'implicit';
    }
    return parsedUrl.searchParams.get('render') || 'default';
  }

  private isCompatibleConfiguration(current: string | undefined, requested: string | undefined): boolean {
    return current === requested;
  }

  private incompatibleConfiguration(
    scriptKey: string,
    current: string | undefined,
    requested: string | undefined,
  ): Promise<void> {
    return Promise.reject(new Error(
      `${scriptKey} is already loading or loaded with render="${current}"; cannot request render="${requested}"`,
    ));
  }

  private cacheScriptLoad(
    scriptKey: string,
    promise: Promise<void>,
    configuration: string | undefined,
    callbackName: string | undefined,
    pending: boolean,
  ): Promise<void> {
    const entry: ScriptLoadEntry = {
      promise,
      configuration,
      callbackName,
      pending,
    };
    this.readyPromises.set(scriptKey, entry);
    promise.then(
      () => entry.pending = false,
      () => entry.pending = false,
    );
    return promise;
  }

  private isProviderAvailable(scriptKey: string): boolean {
    const browserWindow = this.getBrowserWindow('CAPTCHA script loading');
    switch (scriptKey) {
      case 'cloudflare-turnstile':
        return typeof browserWindow.turnstile?.render === 'function'
          && typeof browserWindow.turnstile.execute === 'function';
      case 'alibaba-captcha':
        return typeof browserWindow.initAliyunCaptcha === 'function';
      default:
        if (this.isGoogleScriptKey(scriptKey)) {
          return typeof browserWindow.grecaptcha?.ready === 'function'
            && typeof browserWindow.grecaptcha.render === 'function'
            && typeof browserWindow.grecaptcha.execute === 'function';
        }
        return false;
    }
  }

  private findExistingScript(url: string, scriptKey: string): HTMLScriptElement | undefined {
    if (typeof this.doc.querySelectorAll !== 'function') return undefined;
    const scripts = Array.from(this.doc.querySelectorAll<HTMLScriptElement>('script[src]'))
      .filter(script => !CaptchaService.failedScripts.has(script));
    return scripts.find(script => script.src === url || script.getAttribute('src') === url)
      ?? scripts.find(script => {
        const source = script.getAttribute('src') || script.src;
        return this.isProviderScriptKey(scriptKey) && this.getScriptKey(source) === scriptKey;
      });
  }

  private waitForExistingScript(
    script: HTMLScriptElement,
    scriptKey: string,
    onloadCallbackName?: string,
  ): Promise<void> {
    if (this.isExistingScriptLoaded(script, scriptKey)) {
      return Promise.resolve();
    }

    const browserWindow = this.getBrowserWindow('CAPTCHA script loading');
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let cleanupCallback: () => void = () => undefined;
      const onLoad: EventListener = () => settle(resolve);
      const onError: EventListener = event => rejectOnce(event);
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        script.removeEventListener?.('load', onLoad);
        script.removeEventListener?.('error', onError);
        cleanupCallback();
        callback();
      };
      const rejectOnce = (error: unknown) => {
        if (settled) return;
        CaptchaService.failedScripts.add(script);
        settle(() => reject(error));
      };

      if (onloadCallbackName) {
        try {
          const cleanup = this.installCallback(browserWindow, onloadCallbackName, () => settle(resolve));
          if (!cleanup) {
            reject(new Error(`CAPTCHA script callback "${onloadCallbackName}" is already in use`));
            return;
          }
          cleanupCallback = cleanup;
        } catch (error) {
          reject(error);
          return;
        }
      }

      try {
        script.addEventListener('load', onLoad, { once: true });
        script.addEventListener('error', onError, { once: true });
        timeoutId = setTimeout(() => {
          rejectOnce(new Error(`Timed out waiting for existing CAPTCHA script: ${script.src}`));
        }, CaptchaService.SCRIPT_LOAD_TIMEOUT_MS);
      } catch (error) {
        rejectOnce(error);
      }
    });
  }

  private isExistingScriptLoaded(script: HTMLScriptElement, scriptKey: string): boolean {
    if (script.dataset['ngxCaptchaKitLoaded'] === 'true' || this.isProviderAvailable(scriptKey)) {
      return true;
    }

    const readyState = (script as HTMLScriptElement & { readyState?: string }).readyState;
    if (readyState === 'loaded' || readyState === 'complete') return true;
    return false;
  }

  private installCallback(
    browserWindow: Window,
    callbackName: string,
    onComplete: () => void,
  ): (() => void) | undefined {
    const callbackTarget = browserWindow as unknown as Record<string, unknown>;
    const previousCallback = callbackTarget[callbackName];
    const owner = this.claimCallbackName(browserWindow, callbackName);
    if (!owner) return undefined;

    let installedCallback: (...args: unknown[]) => void;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (callbackTarget[callbackName] === installedCallback) {
        if (previousCallback === undefined) {
          delete callbackTarget[callbackName];
        } else {
          callbackTarget[callbackName] = previousCallback;
        }
      }
      this.releaseCallbackName(browserWindow, callbackName, owner);
    };

    installedCallback = (...args: unknown[]) => {
      try {
        if (typeof previousCallback === 'function') {
          (previousCallback as (...callbackArgs: unknown[]) => unknown)(...args);
        }
      } finally {
        onComplete();
      }
    };

    try {
      callbackTarget[callbackName] = installedCallback;
    } catch (error) {
      this.releaseCallbackName(browserWindow, callbackName, owner);
      throw error;
    }
    return cleanup;
  }

  private claimCallbackName(browserWindow: Window, callbackName: string): symbol | undefined {
    let owners = CaptchaService.callbackOwners.get(browserWindow);
    if (!owners) {
      owners = new Map<string, symbol>();
      CaptchaService.callbackOwners.set(browserWindow, owners);
    }
    if (owners.has(callbackName)) return undefined;

    const owner = Symbol(callbackName);
    owners.set(callbackName, owner);
    return owner;
  }

  private releaseCallbackName(browserWindow: Window, callbackName: string, owner: symbol): void {
    const owners = CaptchaService.callbackOwners.get(browserWindow);
    if (owners?.get(callbackName) !== owner) return;
    owners.delete(callbackName);
    if (owners.size === 0) {
      CaptchaService.callbackOwners.delete(browserWindow);
    }
  }

  private getOrCreateRecaptchaV3Widget(siteKey: string, recaptcha: RecaptchaApi): RecaptchaV3Widget {
    const existingWidget = this.recaptchaV3Widgets.get(siteKey);
    if (existingWidget) return existingWidget;

    const host = this.doc.body || this.doc.documentElement;
    if (!host) {
      throw new Error('Unable to find a document host for the reCAPTCHA v3 widget');
    }

    const container = this.doc.createElement('div');
    host.appendChild(container);

    try {
      const widget: RecaptchaV3Widget = {
        container,
        widgetId: recaptcha.render(container, {
          sitekey: siteKey,
          size: 'invisible',
        }),
        recaptcha,
      };
      this.recaptchaV3Widgets.set(siteKey, widget);
      return widget;
    } catch (error) {
      container.remove();
      throw error;
    }
  }
}
