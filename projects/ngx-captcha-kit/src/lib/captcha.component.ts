import { isPlatformBrowser } from '@angular/common';
import { Component, Input, Output, EventEmitter, AfterViewInit, ElementRef, OnChanges, OnDestroy, SimpleChanges, ViewChild, Inject, PLATFORM_ID } from '@angular/core';
import {
  AlibabaCaptchaInstance,
  AlibabaCaptchaMode,
  AlibabaCaptchaRegion,
  AlibabaCaptchaSlideStyle,
  AlibabaCaptchaVerifyCallback,
  AlibabaCaptchaVerifyResult,
  CaptchaService,
  RecaptchaApi,
  TurnstileApi,
} from './captcha.service';

export type CaptchaType = 'recaptcha-v2' | 'recaptcha-v3' | 'turnstile' | 'alibaba';
export type CaptchaTheme = 'light' | 'dark' | 'auto';
export type CaptchaSize = 'normal' | 'compact' | 'invisible' | 'flexible';
export type TurnstileExecution = 'render' | 'execute';
export type TurnstileAppearance = 'always' | 'execute' | 'interaction-only';

type PendingExecution = {
  version: number;
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
};

@Component({
  standalone: false,
  selector: 'captcha-kit',
  template: `<div #container [id]="containerId" [class]="getClass()"></div>`,
})
export class CaptchaComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() type: CaptchaType | undefined;
  @Input() siteKey?: string;
  @Input() sceneId?: string;
  @Input() prefix?: string;
  @Input() region?: string = 'cn';
  @Input() action?: string;
  @Input() theme?: CaptchaTheme = 'light';
  @Input() size?: CaptchaSize = 'normal';
  @Input() mode?: AlibabaCaptchaMode | 'float' = 'embed';
  @Input() cData?: string;
  @Input() language?: string = 'auto';
  @Input() execution?: TurnstileExecution = 'render';
  @Input() appearance?: TurnstileAppearance;
  @Input() button?: string;
  @Input() captchaVerifyCallback?: AlibabaCaptchaVerifyCallback;
  @Input() onBizResultCallback?: (bizResult: boolean | undefined) => void;
  @Input() getInstance?: (instance: any) => void;
  @Input() slideStyle?: AlibabaCaptchaSlideStyle;
  @Input() immediate?: boolean;
  @Input() timeout?: number;
  @Input() rem?: number;
  @Input() autoRefresh?: boolean;
  @Input() captchaLogoImg?: string;
  @Input() alibabaOnError?: (error: any) => void;
  @Output() resolved = new EventEmitter<string | any>();
  @Output() error = new EventEmitter<any>();
  @Output() bizResult = new EventEmitter<boolean | undefined>();
  @Output() expired = new EventEmitter<void>();
  @Output() timedOut = new EventEmitter<void>();

  @ViewChild('container', { static: true }) private containerRef?: ElementRef<HTMLElement>;

  containerId: string;
  private widgetId?: string | number;
  private alibabaInstance?: AlibabaCaptchaInstance;
  private renderedType?: CaptchaType;
  private isReady = false;
  private viewInitialized = false;
  private destroyed = false;
  private initializationVersion = 0;
  private initializationTask: Promise<void> = Promise.resolve();
  private pendingRecaptchaV3Executions = new Set<PendingExecution>();
  private pendingInvisibleV2Execution?: PendingExecution;
  private pendingTurnstileExecution?: PendingExecution;
  private el: ElementRef<HTMLElement>;

  constructor(
    private captchaService: CaptchaService,
    el: ElementRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.el = el as ElementRef<HTMLElement>;
    this.containerId = this.captchaService.createContainerId();
  }

  async ngAfterViewInit(): Promise<void> {
    this.viewInitialized = true;
    this.initializationTask = this.reinitialize();
    await this.initializationTask;
  }

  ngOnChanges(_changes: SimpleChanges): void {
    if (!this.viewInitialized || this.destroyed) return;
    if (!this.shouldReinitialize(_changes)) return;
    this.initializationTask = this.reinitialize();
  }

  private async reinitialize(): Promise<void> {
    const version = ++this.initializationVersion;
    this.teardownWidget(new Error('Captcha component reinitialized before execution completed'));
    await this.initialize(version);
  }

  private async initialize(version: number): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || !this.isInitializationCurrent(version)) return;

    const type = this.type;
    if (!type) {
      this.emitError('Type is required');
      return;
    }

    if (this.requiresSiteKey(type) && !this.siteKey) {
      this.emitError(`siteKey is required for ${type}`);
      return;
    }

    if (type === 'recaptcha-v2' && this.size === 'flexible') {
      this.emitError('reCAPTCHA v2 does not support size="flexible"');
      return;
    }
    if (type === 'turnstile' && this.size === 'invisible') {
      this.emitError('Turnstile does not support size="invisible"');
      return;
    }

    try {
      switch (type) {
        case 'recaptcha-v2':
          await this.captchaService.loadScript('https://www.google.com/recaptcha/api.js?render=explicit', undefined, this.language);
          if (!this.isInitializationCurrent(version)) return;
          this.widgetId = this.getRecaptcha().render(this.getContainerElement(), {
            sitekey: this.siteKey,
            theme: this.getRecaptchaTheme(),
            size: this.size,
            callback: (token: string) => {
              if (this.isInitializationCurrent(version)) this.emitResolved(token);
            },
            'error-callback': (err: unknown) => {
              if (this.isInitializationCurrent(version)) this.emitError(err);
            },
            'expired-callback': () => {
              if (this.isInitializationCurrent(version)) {
                this.emitError(new Error('reCAPTCHA challenge expired'));
              }
            },
          });
          this.renderedType = type;
          break;

        case 'recaptcha-v3':
          await this.captchaService.loadScript('https://www.google.com/recaptcha/api.js?render=explicit', undefined, this.language);
          if (!this.isInitializationCurrent(version)) return;
          await new Promise<void>(resolve => this.getRecaptcha().ready(resolve));
          if (!this.isInitializationCurrent(version)) return;
          this.widgetId = this.getRecaptcha().render(this.getContainerElement(), {
            sitekey: this.siteKey,
            size: 'invisible',
            theme: this.getRecaptchaTheme(),
          });
          this.renderedType = type;
          this.isReady = true;
          break;

        case 'turnstile':
          await this.captchaService.loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
          if (!this.isInitializationCurrent(version)) return;
          await this.waitForTurnstileReady();
          if (!this.isInitializationCurrent(version)) return;
          this.widgetId = this.getTurnstile().render(this.getContainerElement(), {
            sitekey: this.siteKey,
            action: this.action,
            cData: this.cData,
            theme: this.theme,
            size: this.size === 'invisible' ? undefined : this.size,
            language: this.language,
            execution: this.execution,
            appearance: this.appearance,
            callback: (token: string) => {
              if (this.isInitializationCurrent(version)) this.emitResolved(token);
            },
            'error-callback': (err: unknown) => {
              if (this.isInitializationCurrent(version)) this.emitError(err);
              return true;
            },
            'expired-callback': () => {
              if (this.isInitializationCurrent(version)) this.handleTurnstileExpired();
            },
            'timeout-callback': () => {
              if (this.isInitializationCurrent(version)) this.handleTurnstileTimeout();
            },
          });
          this.renderedType = type;
          break;

        case 'alibaba':
          if (await this.initAlibabaCaptcha(version) && this.isInitializationCurrent(version)) {
            this.renderedType = type;
          }
          break;

        default:
          this.emitError('Unsupported type');
      }
    } catch (err) {
      if (this.isInitializationCurrent(version)) this.emitError(err);
    }
  }

  async execute(): Promise<string> {
    if (this.type === 'recaptcha-v3') {
      return this.executeRecaptchaV3();
    }

    if (this.type === 'recaptcha-v2') {
      return this.executeInvisibleRecaptchaV2();
    }

    if (this.type === 'turnstile') {
      return this.executeTurnstile();
    }

    throw new Error('execute() is only supported for reCAPTCHA v2 invisible, reCAPTCHA v3, and manually executed Turnstile widgets');
  }

  ngOnDestroy() {
    this.destroyed = true;
    ++this.initializationVersion;
    this.teardownWidget(new Error('Captcha component destroyed before execution completed'));
  }

  public getClass(): string {
    return this.type === 'recaptcha-v2' ? 'g-recaptcha' : '';
  }

  private isInitializationCurrent(version: number): boolean {
    return !this.destroyed && version === this.initializationVersion;
  }

  private shouldReinitialize(changes: SimpleChanges): boolean {
    const configurationInputs = [
      'type', 'siteKey', 'sceneId', 'prefix', 'region', 'action', 'theme', 'size', 'mode', 'cData',
      'language', 'execution', 'appearance', 'button', 'slideStyle', 'immediate', 'timeout', 'rem',
      'autoRefresh', 'captchaLogoImg',
    ];
    return configurationInputs.some(input => {
      const change = changes[input];
      if (!change) return false;
      if (input === 'language' && this.isGoogleRecaptcha(this.type)) return false;
      if (input !== 'slideStyle') return true;

      const previous = change.previousValue as AlibabaCaptchaSlideStyle | undefined;
      const current = change.currentValue as AlibabaCaptchaSlideStyle | undefined;
      return previous?.width !== current?.width || previous?.height !== current?.height;
    });
  }

  private teardownWidget(reason: Error): void {
    this.rejectPendingExecutions(reason);
    this.isReady = false;

    const renderedType = this.renderedType;
    const widgetId = this.widgetId;
    const alibabaInstance = this.alibabaInstance;
    this.renderedType = undefined;
    this.widgetId = undefined;
    this.alibabaInstance = undefined;

    this.destroyAlibabaInstance(alibabaInstance);

    if (isPlatformBrowser(this.platformId) && widgetId !== undefined) {
      const browserWindow = window as Window & { grecaptcha?: RecaptchaApi; turnstile?: TurnstileApi };
      try {
        if (renderedType === 'recaptcha-v2' || renderedType === 'recaptcha-v3') {
          browserWindow.grecaptcha?.reset?.(widgetId);
        } else if (renderedType === 'turnstile') {
          browserWindow.turnstile?.remove?.(widgetId);
        }
      } catch {
        // Provider cleanup must not block reinitialization or component destruction.
      }
    }

    if (isPlatformBrowser(this.platformId)) {
      this.containerRef?.nativeElement.replaceChildren();
    }
  }

  private rejectPendingExecutions(reason: Error): void {
    for (const pending of this.pendingRecaptchaV3Executions) {
      pending.reject(reason);
    }
    this.pendingRecaptchaV3Executions.clear();
    this.pendingInvisibleV2Execution?.reject(reason);
    this.pendingInvisibleV2Execution = undefined;
    this.pendingTurnstileExecution?.reject(reason);
    this.pendingTurnstileExecution = undefined;
  }

  private requiresSiteKey(type: CaptchaType): boolean {
    return type === 'recaptcha-v2' || type === 'recaptcha-v3' || type === 'turnstile';
  }

  private isGoogleRecaptcha(type: CaptchaType | undefined): boolean {
    return type === 'recaptcha-v2' || type === 'recaptcha-v3';
  }

  private getContainerElement(): HTMLElement {
    const container = this.containerRef?.nativeElement ?? this.el.nativeElement.querySelector('div');
    if (!container) {
      throw new Error('Captcha container element is not available');
    }
    return container;
  }

  private getRecaptcha(): RecaptchaApi {
    const recaptcha = (window as Window & { grecaptcha?: RecaptchaApi }).grecaptcha;
    if (!recaptcha) {
      throw new Error('reCAPTCHA script loaded but grecaptcha is not available');
    }
    return recaptcha;
  }

  private getTurnstile(): TurnstileApi {
    const turnstile = (window as Window & { turnstile?: TurnstileApi }).turnstile;
    if (!turnstile) {
      throw new Error('Turnstile script loaded but turnstile is not available');
    }
    return turnstile;
  }

  private async waitForTurnstileReady(): Promise<void> {
    const turnstile = this.getTurnstile();
    const ready = turnstile.ready;
    if (typeof ready === 'function') {
      await new Promise<void>(resolve => ready.call(turnstile, resolve));
    }
  }

  private executeRecaptchaV3(): Promise<string> {
    if (!this.isReady || this.widgetId === undefined) {
      throw new Error('reCAPTCHA v3 not ready or missing siteKey');
    }

    const execution = this.getRecaptcha().execute(this.widgetId, { action: this.action });
    if (!execution) {
      throw new Error('reCAPTCHA v3 execute did not return a token promise');
    }

    const version = this.initializationVersion;
    return new Promise<string>((resolve, reject) => {
      const pending: PendingExecution = { version, resolve, reject };
      this.pendingRecaptchaV3Executions.add(pending);
      Promise.resolve(execution).then(
        token => this.resolveRecaptchaV3Execution(pending, token),
        error => this.rejectRecaptchaV3Execution(pending, error),
      );
    });
  }

  private resolveRecaptchaV3Execution(pending: PendingExecution, token: string): void {
    if (!this.pendingRecaptchaV3Executions.delete(pending)) return;
    if (!this.isInitializationCurrent(pending.version)) {
      pending.reject(new Error('reCAPTCHA v3 execution completed after the widget was replaced'));
      return;
    }

    pending.resolve(token);
    this.emitResolved(token);
  }

  private rejectRecaptchaV3Execution(pending: PendingExecution, error: unknown): void {
    if (!this.pendingRecaptchaV3Executions.delete(pending)) return;
    if (!this.isInitializationCurrent(pending.version)) {
      pending.reject(new Error('reCAPTCHA v3 execution failed after the widget was replaced'));
      return;
    }

    pending.reject(error);
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

    const widgetId = this.widgetId;
    const version = this.initializationVersion;
    return new Promise<string>((resolve, reject) => {
      const pending: PendingExecution = { version, resolve, reject };
      this.pendingInvisibleV2Execution = pending;
      try {
        const result = recaptcha.execute(widgetId);
        if (result && typeof result.then === 'function') {
          result.then(
            (token: string) => this.resolveInvisibleV2Thenable(pending, token),
            (error: unknown) => this.rejectInvisibleV2Thenable(pending, error),
          );
        }
      } catch (err) {
        if (this.pendingInvisibleV2Execution === pending) {
          this.pendingInvisibleV2Execution = undefined;
        }
        reject(err);
      }
    });
  }

  private resolveInvisibleV2Thenable(pending: PendingExecution, token: string): void {
    if (this.pendingInvisibleV2Execution !== pending || !this.isInitializationCurrent(pending.version)) return;
    this.emitResolved(token);
  }

  private rejectInvisibleV2Thenable(pending: PendingExecution, error: unknown): void {
    if (this.pendingInvisibleV2Execution !== pending || !this.isInitializationCurrent(pending.version)) return;
    this.emitError(error);
  }

  private executeTurnstile(): Promise<string> {
    if (this.execution !== 'execute') {
      throw new Error('Turnstile execute() requires execution="execute"');
    }
    if (this.widgetId === undefined) {
      throw new Error('Turnstile is not ready');
    }
    if (this.pendingTurnstileExecution) {
      throw new Error('Turnstile execution already in progress');
    }

    const widgetId = this.widgetId;
    const version = this.initializationVersion;
    return new Promise<string>((resolve, reject) => {
      this.pendingTurnstileExecution = { version, resolve, reject };
      try {
        this.getTurnstile().execute(widgetId);
      } catch (err) {
        this.pendingTurnstileExecution = undefined;
        reject(err);
      }
    });
  }

  private async initAlibabaCaptcha(version: number): Promise<boolean> {
    if (!this.validateAlibabaInputs()) {
      return false;
    }

    const alibabaMode = this.getAlibabaMode();
    if (!alibabaMode) return false;

    const region = (this.region ?? 'cn') as AlibabaCaptchaRegion;
    await this.captchaService.loadAlibabaScript(region, this.prefix!);
    if (!this.isInitializationCurrent(version)) return false;

    const browserWindow = window as Window & { initAliyunCaptcha?: (options: Record<string, unknown>) => void };
    const initAliyunCaptcha = browserWindow.initAliyunCaptcha;
    if (typeof initAliyunCaptcha !== 'function') {
      throw new Error('AliyunCaptcha script loaded but initAliyunCaptcha not defined. Check console for errors.');
    }

    initAliyunCaptcha({
      SceneId: this.sceneId,
      mode: alibabaMode,
      element: `#${this.containerId}`,
      button: this.button,
      captchaVerifyCallback: (param: string) => this.handleAlibabaVerify(param, version),
      onBizResultCallback: (result: boolean | undefined) => this.handleAlibabaBizResult(result, version),
      getInstance: (instance: AlibabaCaptchaInstance) => this.handleAlibabaInstance(instance, version),
      slideStyle: this.slideStyle,
      language: this.normalizeAlibabaLanguage(this.language),
      immediate: this.immediate,
      timeout: this.timeout,
      rem: this.rem,
      autoRefresh: this.autoRefresh,
      onError: (err: unknown) => this.handleAlibabaError(err, version),
      captchaLogoImg: this.captchaLogoImg,
    });
    return true;
  }

  private validateAlibabaInputs(): boolean {
    if (!this.sceneId || !this.prefix) {
      this.emitError('SceneId and Prefix are required for Alibaba Captcha');
      return false;
    }
    if (!this.button) {
      this.emitError('button is required for Alibaba Captcha 2.0');
      return false;
    }
    if (!this.captchaVerifyCallback) {
      this.emitError('captchaVerifyCallback is required for Alibaba Captcha 2.0');
      return false;
    }
    const region = this.region ?? 'cn';
    if (region !== 'cn' && region !== 'sgp') {
      this.emitError('Alibaba Captcha 2.0 region must be "cn" or "sgp"');
      return false;
    }
    return true;
  }

  private getAlibabaMode(): AlibabaCaptchaMode | undefined {
    const mode = this.mode || 'embed';
    if (mode !== 'embed' && mode !== 'popup') {
      this.emitError('Alibaba Captcha 2.0 supports only "embed" or "popup" mode');
      return undefined;
    }
    return mode;
  }

  private async handleAlibabaVerify(captchaVerifyParam: string, version: number): Promise<AlibabaCaptchaVerifyResult> {
    if (!this.isInitializationCurrent(version)) {
      return { captchaResult: false, bizResult: false };
    }

    const verifyCallback = this.captchaVerifyCallback;
    this.emitResolved(captchaVerifyParam);
    if (!this.isInitializationCurrent(version)) {
      return { captchaResult: false, bizResult: false };
    }

    try {
      const result = await verifyCallback?.(captchaVerifyParam);
      if (!this.isInitializationCurrent(version)) {
        return { captchaResult: false, bizResult: false };
      }
      if (!result || typeof result.captchaResult !== 'boolean') {
        throw new Error('Alibaba captchaVerifyCallback must return { captchaResult: boolean, bizResult?: boolean }');
      }
      return result;
    } catch (err) {
      if (!this.isInitializationCurrent(version)) {
        return { captchaResult: false, bizResult: false };
      }
      this.emitError(err);
      return { captchaResult: false, bizResult: false };
    }
  }

  private handleAlibabaBizResult(result: boolean | undefined, version: number): void {
    if (!this.isInitializationCurrent(version)) return;

    const callback = this.onBizResultCallback;
    this.bizResult.emit(result);
    if (!this.isInitializationCurrent(version)) return;
    callback?.(result);
  }

  private handleAlibabaInstance(instance: AlibabaCaptchaInstance, version: number): void {
    if (!this.isInitializationCurrent(version)) {
      this.destroyAlibabaInstance(instance);
      return;
    }

    const previousInstance = this.alibabaInstance;
    this.alibabaInstance = instance;
    if (previousInstance && previousInstance !== instance) {
      this.destroyAlibabaInstance(previousInstance);
    }

    this.getInstance?.(instance);
  }

  private destroyAlibabaInstance(instance: AlibabaCaptchaInstance | undefined): void {
    try {
      instance?.destroyCaptcha?.();
    } catch {
      // Provider cleanup must not block reinitialization or component destruction.
    }
  }

  private handleAlibabaError(err: unknown, version: number): void {
    if (!this.isInitializationCurrent(version)) return;

    const callback = this.alibabaOnError;
    this.emitError(err);
    if (!this.isInitializationCurrent(version)) return;
    callback?.(err);
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

  private getRecaptchaTheme(): 'light' | 'dark' {
    if (this.theme === 'dark') return 'dark';
    if (this.theme === 'auto' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }

  private handleTurnstileExpired(): void {
    if (this.destroyed) return;
    const pending = this.pendingTurnstileExecution?.version === this.initializationVersion
      ? this.pendingTurnstileExecution
      : undefined;
    if (pending) {
      this.pendingTurnstileExecution = undefined;
      pending.reject(new Error('Turnstile token expired'));
    }
    this.expired.emit();
  }

  private handleTurnstileTimeout(): void {
    if (this.destroyed) return;
    const pending = this.pendingTurnstileExecution?.version === this.initializationVersion
      ? this.pendingTurnstileExecution
      : undefined;
    if (pending) {
      this.pendingTurnstileExecution = undefined;
      pending.reject(new Error('Turnstile challenge timed out'));
    }
    this.timedOut.emit();
  }

  private emitResolved(value: string): void {
    if (this.destroyed) return;

    const invisibleV2Execution = this.pendingInvisibleV2Execution?.version === this.initializationVersion
      ? this.pendingInvisibleV2Execution
      : undefined;
    const turnstileExecution = this.pendingTurnstileExecution?.version === this.initializationVersion
      ? this.pendingTurnstileExecution
      : undefined;
    if (invisibleV2Execution) {
      this.pendingInvisibleV2Execution = undefined;
      invisibleV2Execution.resolve(value);
    }
    if (turnstileExecution) {
      this.pendingTurnstileExecution = undefined;
      turnstileExecution.resolve(value);
    }
    this.resolved.emit(value);
  }

  private emitError(err: unknown): void {
    const invisibleV2Execution = this.pendingInvisibleV2Execution?.version === this.initializationVersion
      ? this.pendingInvisibleV2Execution
      : undefined;
    const turnstileExecution = this.pendingTurnstileExecution?.version === this.initializationVersion
      ? this.pendingTurnstileExecution
      : undefined;
    if (invisibleV2Execution) {
      this.pendingInvisibleV2Execution = undefined;
      invisibleV2Execution.reject(err);
    }
    if (turnstileExecution) {
      this.pendingTurnstileExecution = undefined;
      turnstileExecution.reject(err);
    }
    if (!this.destroyed) {
      this.error.emit(err);
    }
  }
}
