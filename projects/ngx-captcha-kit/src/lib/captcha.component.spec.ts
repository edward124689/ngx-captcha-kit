import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ElementRef, SimpleChange } from '@angular/core';
import { CaptchaComponent } from './captcha.component';
import { AlibabaCaptchaOptions, AlibabaCaptchaRegion, CaptchaService } from './captcha.service';

class MockCaptchaService {
  loadScript = jasmine.createSpy('loadScript').and.returnValue(Promise.resolve());
  loadAlibabaScript = jasmine.createSpy('loadAlibabaScript').and.callFake(
    (region: AlibabaCaptchaRegion, prefix: string) => {
      (window as any).AliyunCaptchaConfig = { region, prefix };
      return Promise.resolve();
    },
  );
  private nextContainerId = 0;

  createContainerId(): string {
    return `captcha-container-${this.nextContainerId++}`;
  }
}

describe('CaptchaComponent', () => {
  let fixture: ComponentFixture<CaptchaComponent>;
  let component: CaptchaComponent;
  let captchaService: MockCaptchaService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [CaptchaComponent],
      providers: [{ provide: CaptchaService, useClass: MockCaptchaService }],
    }).compileComponents();

    captchaService = TestBed.inject(CaptchaService) as unknown as MockCaptchaService;
  });

  afterEach(() => {
    delete (window as any).grecaptcha;
    delete (window as any).turnstile;
    delete (window as any).initAliyunCaptcha;
    delete (window as any).AliyunCaptchaConfig;
    delete (window as any).existingCallback;
    delete (window as any).sharedCallback;
    delete (window as any).neverCalled;
    delete (window as any).lateCallback;
    delete (window as any).timedOutCallback;
  });

  function createComponent(): CaptchaComponent {
    fixture = TestBed.createComponent(CaptchaComponent);
    component = fixture.componentInstance;
    return component;
  }

  async function initializeComponent(): Promise<void> {
    (component as any).containerRef = new ElementRef(document.createElement('div'));
    await component.ngAfterViewInit();
  }

  it('emits an error when a siteKey-backed captcha is missing siteKey', async () => {
    createComponent();
    spyOn(component.error, 'emit');
    component.type = 'recaptcha-v2';

    await initializeComponent();

    expect(component.error.emit).toHaveBeenCalledOnceWith('siteKey is required for recaptcha-v2');
    expect(captchaService.loadScript).not.toHaveBeenCalled();
  });

  it('uses a unique container id for each component instance', () => {
    const first = TestBed.createComponent(CaptchaComponent).componentInstance;
    const second = TestBed.createComponent(CaptchaComponent).componentInstance;

    expect(first.containerId).not.toEqual(second.containerId);
  });

  it('preserves the public input and output type compatibility from 22.1', () => {
    createComponent();
    const configuredRegion: string = 'cn';
    component.region = configuredRegion;
    component.mode = 'float';
    component.getInstance = (instance: { reload(): void }) => instance.reload();
    component.alibabaOnError = (error: Error) => error.message;

    const resolvedSubscription = component.resolved.subscribe((value: number) => value.toFixed());
    const errorSubscription = component.error.subscribe((error: Error) => error.message);
    const options: AlibabaCaptchaOptions = {
      element: '#captcha',
      button: '#submit',
      captchaVerifyCallback: () => ({ captchaResult: true }),
      prefix: 'prefix',
      region: configuredRegion,
      getInstance: (instance: { reload(): void }) => instance.reload(),
      onError: (error: Error) => error.message,
    };

    expect(options.region).toBe(configuredRegion);
    resolvedSubscription.unsubscribe();
    errorSubscription.unsubscribe();
  });

  it('preserves the public constructor type compatibility from 22.1', () => {
    const service = new CaptchaService({ defaultView: window }, 'browser');
    const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const svgRef = new ElementRef<SVGElement>(svgElement);

    const manuallyConstructed = new CaptchaComponent(service, svgRef, 'browser');

    expect(manuallyConstructed.containerId).toBe('captcha-container-0');
  });

  it('does not mark explicitly rendered Turnstile containers for implicit rendering', () => {
    createComponent();
    component.type = 'turnstile';

    expect(component.getClass()).toBe('');
  });

  it('executes reCAPTCHA v3 after the script is ready', async () => {
    createComponent();
    spyOn(component.resolved, 'emit');
    (window as any).grecaptcha = {
      ready: (callback: () => void) => callback(),
      render: jasmine.createSpy('render').and.returnValue(11),
      execute: jasmine.createSpy('execute').and.resolveTo('v3-token'),
      reset: jasmine.createSpy('reset'),
    };

    component.type = 'recaptcha-v3';
    component.siteKey = 'site-key';
    component.action = 'submit';

    await initializeComponent();

    const token = await component.execute();

    expect(token).toBe('v3-token');
    expect(captchaService.loadScript).toHaveBeenCalledOnceWith(
      'https://www.google.com/recaptcha/api.js?render=explicit',
      undefined,
      'auto',
    );
    expect((window as any).grecaptcha.render).toHaveBeenCalledWith(
      jasmine.any(HTMLElement),
      { sitekey: 'site-key', size: 'invisible', theme: 'light' },
    );
    expect((window as any).grecaptcha.execute).toHaveBeenCalledOnceWith(11, { action: 'submit' });
    expect(component.resolved.emit).toHaveBeenCalledOnceWith('v3-token');
  });

  it('rejects and ignores a stale reCAPTCHA v3 execution after reinitialization', async () => {
    createComponent();
    spyOn(component.resolved, 'emit');
    let resolveExecution!: (token: string) => void;
    (window as any).grecaptcha = {
      ready: (callback: () => void) => callback(),
      render: jasmine.createSpy('render').and.returnValues(11, 12),
      execute: jasmine.createSpy('execute').and.returnValue(new Promise<string>(resolve => {
        resolveExecution = resolve;
      })),
      reset: jasmine.createSpy('reset'),
    };
    component.type = 'recaptcha-v3';
    component.siteKey = 'first-site-key';
    await initializeComponent();

    const execution = component.execute();
    component.siteKey = 'second-site-key';
    component.ngOnChanges({
      siteKey: new SimpleChange('first-site-key', 'second-site-key', false),
    });

    await expectAsync(execution).toBeRejectedWithError(
      'Captcha component reinitialized before execution completed',
    );
    await (component as any).initializationTask;
    resolveExecution('stale-token');
    await Promise.resolve();
    await Promise.resolve();

    expect(component.resolved.emit).not.toHaveBeenCalled();
  });

  it('supports execute() for invisible reCAPTCHA v2', async () => {
    createComponent();
    spyOn(component.resolved, 'emit');
    let renderOptions: any;
    (window as any).grecaptcha = {
      render: jasmine.createSpy('render').and.callFake((_element: HTMLElement, options: any) => {
        renderOptions = options;
        return 7;
      }),
      execute: jasmine.createSpy('execute').and.callFake(() => renderOptions.callback('v2-token')),
      reset: jasmine.createSpy('reset'),
    };

    component.type = 'recaptcha-v2';
    component.siteKey = 'site-key';
    component.size = 'invisible';

    await initializeComponent();

    const token = await component.execute();

    expect(token).toBe('v2-token');
    expect((window as any).grecaptcha.execute).toHaveBeenCalledOnceWith(7);
    expect(component.resolved.emit).toHaveBeenCalledOnceWith('v2-token');
    expect((window as any).ngRecaptchaOnload).toBeUndefined();
  });

  it('settles invisible reCAPTCHA v2 before a resolved subscriber reinitializes the component', async () => {
    createComponent();
    const renderOptions: any[] = [];
    (window as any).grecaptcha = {
      render: jasmine.createSpy('render').and.callFake((_element: HTMLElement, options: any) => {
        renderOptions.push(options);
        return renderOptions.length + 6;
      }),
      execute: jasmine.createSpy('execute'),
      reset: jasmine.createSpy('reset'),
    };
    component.type = 'recaptcha-v2';
    component.siteKey = 'first-site-key';
    component.size = 'invisible';
    await initializeComponent();
    component.resolved.subscribe(() => {
      component.siteKey = 'second-site-key';
      component.ngOnChanges({
        siteKey: new SimpleChange('first-site-key', 'second-site-key', false),
      });
    });

    const execution = component.execute();
    renderOptions[0].callback('valid-token');

    await expectAsync(execution).toBeResolvedTo('valid-token');
    await (component as any).initializationTask;
  });

  it('preserves the provider error when an error subscriber reinitializes the component', async () => {
    createComponent();
    const renderOptions: any[] = [];
    (window as any).grecaptcha = {
      render: jasmine.createSpy('render').and.callFake((_element: HTMLElement, options: any) => {
        renderOptions.push(options);
        return renderOptions.length + 6;
      }),
      execute: jasmine.createSpy('execute'),
      reset: jasmine.createSpy('reset'),
    };
    component.type = 'recaptcha-v2';
    component.siteKey = 'first-site-key';
    component.size = 'invisible';
    await initializeComponent();
    component.error.subscribe(() => {
      component.siteKey = 'second-site-key';
      component.ngOnChanges({
        siteKey: new SimpleChange('first-site-key', 'second-site-key', false),
      });
    });
    const providerError = new Error('provider error');

    const execution = component.execute();
    renderOptions[0]['error-callback'](providerError);

    await expectAsync(execution).toBeRejectedWith(providerError);
    await (component as any).initializationTask;
  });

  it('maps the auto theme to a reCAPTCHA-compatible system theme', async () => {
    createComponent();
    spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);
    (window as any).grecaptcha = {
      render: jasmine.createSpy('render').and.returnValue(7),
      reset: jasmine.createSpy('reset'),
    };

    component.type = 'recaptcha-v2';
    component.siteKey = 'site-key';
    component.theme = 'auto';

    await initializeComponent();

    expect(window.matchMedia).toHaveBeenCalledOnceWith('(prefers-color-scheme: dark)');
    expect((window as any).grecaptcha.render).toHaveBeenCalledWith(
      jasmine.any(HTMLElement),
      jasmine.objectContaining({ theme: 'dark' }),
    );
  });

  it('rejects invisible reCAPTCHA v2 execution when the challenge expires', async () => {
    createComponent();
    let renderOptions: any;
    (window as any).grecaptcha = {
      render: jasmine.createSpy('render').and.callFake((_element: HTMLElement, options: any) => {
        renderOptions = options;
        return 7;
      }),
      execute: jasmine.createSpy('execute'),
      reset: jasmine.createSpy('reset'),
    };

    component.type = 'recaptcha-v2';
    component.siteKey = 'site-key';
    component.size = 'invisible';

    await initializeComponent();

    const promise = component.execute();
    renderOptions['expired-callback']();

    await expectAsync(promise).toBeRejectedWithError('reCAPTCHA challenge expired');
  });

  it('throws when execute() is used for visible reCAPTCHA v2', async () => {
    createComponent();
    (window as any).grecaptcha = {
      render: jasmine.createSpy('render').and.returnValue(7),
      reset: jasmine.createSpy('reset'),
    };

    component.type = 'recaptcha-v2';
    component.siteKey = 'site-key';
    component.size = 'normal';

    await initializeComponent();

    await expectAsync(component.execute()).toBeRejectedWithError('reCAPTCHA v2 execute() requires size="invisible"');
  });

  it('renders and manually executes Turnstile with current widget options', async () => {
    createComponent();
    spyOn(component.resolved, 'emit');
    spyOn(component.expired, 'emit');
    spyOn(component.timedOut, 'emit');
    let renderOptions: any;
    (window as any).turnstile = {
      ready: (callback: () => void) => callback(),
      render: jasmine.createSpy('render').and.callFake((_element: HTMLElement, options: any) => {
        renderOptions = options;
        return 'widget-id';
      }),
      execute: jasmine.createSpy('execute'),
      remove: jasmine.createSpy('remove'),
    };

    component.type = 'turnstile';
    component.siteKey = 'site-key';
    component.action = 'submit';
    component.size = 'flexible';
    component.execution = 'execute';
    component.appearance = 'interaction-only';

    await initializeComponent();

    expect((window as any).turnstile.render).toHaveBeenCalledWith(
      jasmine.any(HTMLElement),
      jasmine.objectContaining({
        sitekey: 'site-key',
        size: 'flexible',
        execution: 'execute',
        appearance: 'interaction-only',
      }),
    );

    const tokenPromise = component.execute();
    expect((window as any).turnstile.execute).toHaveBeenCalledOnceWith('widget-id');
    renderOptions.callback('turnstile-token');

    await expectAsync(tokenPromise).toBeResolvedTo('turnstile-token');
    expect(component.resolved.emit).toHaveBeenCalledOnceWith('turnstile-token');

    renderOptions['expired-callback']();
    renderOptions['timeout-callback']();
    expect(renderOptions['error-callback']('turnstile-error')).toBeTrue();
    expect(component.expired.emit).toHaveBeenCalledTimes(1);
    expect(component.timedOut.emit).toHaveBeenCalledTimes(1);
    expect((window as any).turnstileOnload).toBeUndefined();
  });

  it('settles a Turnstile expiry before an expired subscriber reinitializes the component', async () => {
    createComponent();
    const renderOptions: any[] = [];
    (window as any).turnstile = {
      ready: (callback: () => void) => callback(),
      render: jasmine.createSpy('render').and.callFake((_element: HTMLElement, options: any) => {
        renderOptions.push(options);
        return `widget-${renderOptions.length}`;
      }),
      execute: jasmine.createSpy('execute'),
      remove: jasmine.createSpy('remove'),
    };
    component.type = 'turnstile';
    component.siteKey = 'first-site-key';
    component.execution = 'execute';
    await initializeComponent();
    component.expired.subscribe(() => {
      component.siteKey = 'second-site-key';
      component.ngOnChanges({
        siteKey: new SimpleChange('first-site-key', 'second-site-key', false),
      });
    });

    const execution = component.execute();
    renderOptions[0]['expired-callback']();

    await expectAsync(execution).toBeRejectedWithError('Turnstile token expired');
    await (component as any).initializationTask;
  });

  it('rejects the unsupported invisible Turnstile size', async () => {
    createComponent();
    spyOn(component.error, 'emit');
    component.type = 'turnstile';
    component.siteKey = 'site-key';
    component.size = 'invisible';

    await initializeComponent();

    expect(component.error.emit).toHaveBeenCalledOnceWith('Turnstile does not support size="invisible"');
    expect(captchaService.loadScript).not.toHaveBeenCalled();
  });

  it('requires Alibaba Captcha 2.0 button and captchaVerifyCallback', async () => {
    createComponent();
    spyOn(component.error, 'emit');

    component.type = 'alibaba';
    component.sceneId = 'scene-id';
    component.prefix = 'prefix';

    await initializeComponent();

    expect(component.error.emit).toHaveBeenCalledOnceWith('button is required for Alibaba Captcha 2.0');
    expect(captchaService.loadScript).not.toHaveBeenCalled();
  });

  it('initializes Alibaba Captcha 2.0 with V2 callbacks and options', async () => {
    createComponent();
    spyOn(component.resolved, 'emit');
    spyOn(component.bizResult, 'emit');
    spyOn(component.error, 'emit');
    const verifyCallback = jasmine.createSpy('verifyCallback').and.resolveTo({ captchaResult: true, bizResult: true });
    const bizResultCallback = jasmine.createSpy('bizResultCallback');
    const getInstance = jasmine.createSpy('getInstance');
    const alibabaOnError = jasmine.createSpy('alibabaOnError');
    let initOptions: any;
    (window as any).initAliyunCaptcha = jasmine.createSpy('initAliyunCaptcha').and.callFake((options: any) => {
      initOptions = options;
    });

    component.type = 'alibaba';
    component.sceneId = 'scene-id';
    component.prefix = 'prefix';
    component.region = 'sgp';
    component.mode = 'popup';
    component.button = '#login-button';
    component.captchaVerifyCallback = verifyCallback;
    component.onBizResultCallback = bizResultCallback;
    component.getInstance = getInstance;
    component.slideStyle = { width: 360, height: 40 };
    component.language = 'en';
    component.immediate = true;
    component.timeout = 6000;
    component.rem = 1.2;
    component.autoRefresh = false;
    component.captchaLogoImg = 'data:image/png;base64,logo';
    component.alibabaOnError = alibabaOnError;

    await initializeComponent();

    expect((window as any).AliyunCaptchaConfig).toEqual({ region: 'sgp', prefix: 'prefix' });
    expect((window as any).initAliyunCaptcha).toHaveBeenCalled();
    expect(initOptions).toEqual(jasmine.objectContaining({
      SceneId: 'scene-id',
      mode: 'popup',
      element: `#${component.containerId}`,
      button: '#login-button',
      slideStyle: { width: 360, height: 40 },
      language: 'en',
      immediate: true,
      timeout: 6000,
      rem: 1.2,
      autoRefresh: false,
      captchaLogoImg: 'data:image/png;base64,logo',
    }));

    await expectAsync(initOptions.captchaVerifyCallback('captcha-param')).toBeResolvedTo({ captchaResult: true, bizResult: true });
    expect(verifyCallback).toHaveBeenCalledOnceWith('captcha-param');
    expect(component.resolved.emit).toHaveBeenCalledOnceWith('captcha-param');

    initOptions.onBizResultCallback(false);
    expect(component.bizResult.emit).toHaveBeenCalledOnceWith(false);
    expect(bizResultCallback).toHaveBeenCalledOnceWith(false);

    initOptions.getInstance({ reload: true });
    expect(getInstance).toHaveBeenCalledOnceWith({ reload: true });

    initOptions.onError('aliyun-error');
    expect(component.error.emit).toHaveBeenCalledOnceWith('aliyun-error');
    expect(alibabaOnError).toHaveBeenCalledOnceWith('aliyun-error');
  });

  it('does not send an old Alibaba biz result to a callback replaced during its output', async () => {
    createComponent();
    let initOptions: any;
    (window as any).initAliyunCaptcha = jasmine.createSpy('initAliyunCaptcha').and.callFake((options: any) => {
      initOptions = options;
    });
    const oldCallback = jasmine.createSpy('oldCallback');
    const newCallback = jasmine.createSpy('newCallback');
    component.type = 'alibaba';
    component.sceneId = 'first-scene';
    component.prefix = 'prefix';
    component.button = '#login-button';
    component.captchaVerifyCallback = () => ({ captchaResult: true });
    component.onBizResultCallback = oldCallback;
    await initializeComponent();
    component.bizResult.subscribe(() => {
      component.sceneId = 'second-scene';
      component.onBizResultCallback = newCallback;
      component.ngOnChanges({
        sceneId: new SimpleChange('first-scene', 'second-scene', false),
      });
    });

    initOptions.onBizResultCallback(true);

    expect(oldCallback).not.toHaveBeenCalled();
    expect(newCallback).not.toHaveBeenCalled();
    await (component as any).initializationTask;
  });

  it('does not send an old Alibaba error to a callback replaced during its output', async () => {
    createComponent();
    let initOptions: any;
    (window as any).initAliyunCaptcha = jasmine.createSpy('initAliyunCaptcha').and.callFake((options: any) => {
      initOptions = options;
    });
    const oldCallback = jasmine.createSpy('oldCallback');
    const newCallback = jasmine.createSpy('newCallback');
    component.type = 'alibaba';
    component.sceneId = 'first-scene';
    component.prefix = 'prefix';
    component.button = '#login-button';
    component.captchaVerifyCallback = () => ({ captchaResult: true });
    component.alibabaOnError = oldCallback;
    await initializeComponent();
    component.error.subscribe(() => {
      component.sceneId = 'second-scene';
      component.alibabaOnError = newCallback;
      component.ngOnChanges({
        sceneId: new SimpleChange('first-scene', 'second-scene', false),
      });
    });

    initOptions.onError('provider-error');

    expect(oldCallback).not.toHaveBeenCalled();
    expect(newCallback).not.toHaveBeenCalled();
    await (component as any).initializationTask;
  });

  it('destroys the active Alibaba instance before reinitializing', async () => {
    createComponent();
    const initOptions: any[] = [];
    (window as any).initAliyunCaptcha = jasmine.createSpy('initAliyunCaptcha').and.callFake((options: any) => {
      initOptions.push(options);
    });
    component.type = 'alibaba';
    component.sceneId = 'first-scene';
    component.prefix = 'prefix';
    component.button = '#login-button';
    component.captchaVerifyCallback = () => ({ captchaResult: true });
    await initializeComponent();
    const destroyCaptcha = jasmine.createSpy('destroyCaptcha');
    initOptions[0].getInstance({ destroyCaptcha });

    component.sceneId = 'second-scene';
    component.ngOnChanges({
      sceneId: new SimpleChange('first-scene', 'second-scene', false),
    });
    await (component as any).initializationTask;

    expect(destroyCaptcha).toHaveBeenCalledTimes(1);
    expect((window as any).initAliyunCaptcha).toHaveBeenCalledTimes(2);
  });

  it('destroys the active Alibaba instance when the component is destroyed', async () => {
    createComponent();
    let initOptions: any;
    (window as any).initAliyunCaptcha = jasmine.createSpy('initAliyunCaptcha').and.callFake((options: any) => {
      initOptions = options;
    });
    component.type = 'alibaba';
    component.sceneId = 'scene-id';
    component.prefix = 'prefix';
    component.button = '#login-button';
    component.captchaVerifyCallback = () => ({ captchaResult: true });
    await initializeComponent();
    const destroyCaptcha = jasmine.createSpy('destroyCaptcha');
    initOptions.getInstance({ destroyCaptcha });

    component.ngOnDestroy();

    expect(destroyCaptcha).toHaveBeenCalledTimes(1);
  });

  it('destroys an Alibaba instance delivered by a stale initialization', async () => {
    createComponent();
    const initOptions: any[] = [];
    (window as any).initAliyunCaptcha = jasmine.createSpy('initAliyunCaptcha').and.callFake((options: any) => {
      initOptions.push(options);
    });
    component.type = 'alibaba';
    component.sceneId = 'first-scene';
    component.prefix = 'prefix';
    component.button = '#login-button';
    component.captchaVerifyCallback = () => ({ captchaResult: true });
    await initializeComponent();
    const staleGetInstance = initOptions[0].getInstance;

    component.sceneId = 'second-scene';
    component.ngOnChanges({
      sceneId: new SimpleChange('first-scene', 'second-scene', false),
    });
    await (component as any).initializationTask;
    const destroyCaptcha = jasmine.createSpy('destroyCaptcha');
    staleGetInstance({ destroyCaptcha });

    expect(destroyCaptcha).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported Alibaba float mode', async () => {
    createComponent();
    spyOn(component.error, 'emit');

    component.type = 'alibaba';
    component.sceneId = 'scene-id';
    component.prefix = 'prefix';
    component.mode = 'float' as any;
    component.button = '#login-button';
    component.captchaVerifyCallback = () => ({ captchaResult: true });

    await initializeComponent();

    expect(component.error.emit).toHaveBeenCalledOnceWith('Alibaba Captcha 2.0 supports only "embed" or "popup" mode');
    expect(captchaService.loadScript).not.toHaveBeenCalled();
  });

  it('returns a failed Alibaba verification when an async result becomes stale', async () => {
    createComponent();
    spyOn(component.error, 'emit');
    let resolveVerification!: (result: { captchaResult: boolean }) => void;
    let initOptions: any;
    (window as any).initAliyunCaptcha = jasmine.createSpy('initAliyunCaptcha').and.callFake((options: any) => {
      initOptions = options;
    });
    component.type = 'alibaba';
    component.sceneId = 'first-scene';
    component.prefix = 'prefix';
    component.button = '#login-button';
    component.captchaVerifyCallback = () => new Promise(resolve => {
      resolveVerification = resolve;
    });
    await initializeComponent();

    const staleCallback = initOptions.captchaVerifyCallback;
    const verification = staleCallback('captcha-param');
    component.sceneId = 'second-scene';
    component.ngOnChanges({
      sceneId: new SimpleChange('first-scene', 'second-scene', false),
    });
    await (component as any).initializationTask;
    resolveVerification({ captchaResult: true });

    await expectAsync(verification).toBeResolvedTo({ captchaResult: false, bizResult: false });
    expect(component.error.emit).not.toHaveBeenCalled();
  });

  it('suppresses an Alibaba verification error that becomes stale', async () => {
    createComponent();
    spyOn(component.error, 'emit');
    let rejectVerification!: (error: unknown) => void;
    let initOptions: any;
    (window as any).initAliyunCaptcha = jasmine.createSpy('initAliyunCaptcha').and.callFake((options: any) => {
      initOptions = options;
    });
    component.type = 'alibaba';
    component.sceneId = 'first-scene';
    component.prefix = 'prefix';
    component.button = '#login-button';
    component.captchaVerifyCallback = () => new Promise((_resolve, reject) => {
      rejectVerification = reject;
    });
    await initializeComponent();

    const staleCallback = initOptions.captchaVerifyCallback;
    const verification = staleCallback('captcha-param');
    component.sceneId = 'second-scene';
    component.ngOnChanges({
      sceneId: new SimpleChange('first-scene', 'second-scene', false),
    });
    await (component as any).initializationTask;
    rejectVerification(new Error('stale backend failure'));

    await expectAsync(verification).toBeResolvedTo({ captchaResult: false, bizResult: false });
    expect(component.error.emit).not.toHaveBeenCalled();
  });

  it('does not verify Alibaba CAPTCHA after a resolved subscriber reinitializes the widget', async () => {
    createComponent();
    const verifyCallback = jasmine.createSpy('verifyCallback').and.returnValue({ captchaResult: true });
    let initOptions: any;
    (window as any).initAliyunCaptcha = jasmine.createSpy('initAliyunCaptcha').and.callFake((options: any) => {
      initOptions = options;
    });
    component.type = 'alibaba';
    component.sceneId = 'first-scene';
    component.prefix = 'prefix';
    component.button = '#login-button';
    component.captchaVerifyCallback = verifyCallback;
    await initializeComponent();

    const staleVerifyCallback = initOptions.captchaVerifyCallback;
    component.resolved.subscribe(() => {
      component.sceneId = 'second-scene';
      component.ngOnChanges({
        sceneId: new SimpleChange('first-scene', 'second-scene', false),
      });
    });

    await expectAsync(staleVerifyCallback('captcha-param')).toBeResolvedTo({
      captchaResult: false,
      bizResult: false,
    });
    await (component as any).initializationTask;
    expect(verifyCallback).not.toHaveBeenCalled();
  });

  it('tears down and re-renders when provider inputs change', async () => {
    createComponent();
    spyOn(component.resolved, 'emit');
    const renderOptions: any[] = [];
    const render = jasmine.createSpy('render').and.callFake((_element: HTMLElement, options: any) => {
      renderOptions.push(options);
      return renderOptions.length + 6;
    });
    const reset = jasmine.createSpy('reset');
    (window as any).grecaptcha = { render, reset };
    component.type = 'recaptcha-v2';
    component.siteKey = 'first-site-key';

    await initializeComponent();

    component.siteKey = 'second-site-key';
    component.ngOnChanges({
      siteKey: new SimpleChange('first-site-key', 'second-site-key', false),
    });
    await (component as any).initializationTask;

    expect(reset).toHaveBeenCalledOnceWith(7);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      sitekey: 'second-site-key',
    }));

    renderOptions[0].callback('stale-token');
    renderOptions[1].callback('fresh-token');
    expect(component.resolved.emit).toHaveBeenCalledOnceWith('fresh-token');
  });

  it('does not re-render for callback-only input changes', async () => {
    createComponent();
    const render = jasmine.createSpy('render').and.returnValue(7);
    const reset = jasmine.createSpy('reset');
    (window as any).grecaptcha = { render, reset };
    component.type = 'recaptcha-v2';
    component.siteKey = 'site-key';
    await initializeComponent();

    const previousCallback = component.getInstance;
    component.getInstance = jasmine.createSpy('getInstance');
    component.ngOnChanges({
      getInstance: new SimpleChange(previousCallback, component.getInstance, false),
    });
    await (component as any).initializationTask;

    expect(render).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it('does not re-render Google reCAPTCHA for a page-locked language change', async () => {
    createComponent();
    const render = jasmine.createSpy('render').and.returnValue(7);
    const reset = jasmine.createSpy('reset');
    (window as any).grecaptcha = { render, reset };
    component.type = 'recaptcha-v2';
    component.siteKey = 'site-key';
    component.language = 'en';
    await initializeComponent();

    component.language = 'zh-TW';
    component.ngOnChanges({
      language: new SimpleChange('en', 'zh-TW', false),
    });
    await (component as any).initializationTask;

    expect(render).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it('rejects a pending manual execution when inputs trigger reinitialization', async () => {
    createComponent();
    const render = jasmine.createSpy('render').and.returnValues(7, 8);
    (window as any).grecaptcha = {
      render,
      execute: jasmine.createSpy('execute'),
      reset: jasmine.createSpy('reset'),
    };
    component.type = 'recaptcha-v2';
    component.siteKey = 'first-site-key';
    component.size = 'invisible';
    await initializeComponent();

    const execution = component.execute();
    component.siteKey = 'second-site-key';
    component.ngOnChanges({
      siteKey: new SimpleChange('first-site-key', 'second-site-key', false),
    });

    await expectAsync(execution).toBeRejectedWithError(
      'Captcha component reinitialized before execution completed',
    );
    await (component as any).initializationTask;
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale reCAPTCHA v2 thenable settle a newer execution', async () => {
    createComponent();
    spyOn(component.resolved, 'emit');
    let resolveFirst!: (token: string) => void;
    let resolveSecond!: (token: string) => void;
    const firstResult = new Promise<string>(resolve => resolveFirst = resolve);
    const secondResult = new Promise<string>(resolve => resolveSecond = resolve);
    const render = jasmine.createSpy('render').and.returnValues(7, 8);
    (window as any).grecaptcha = {
      render,
      execute: jasmine.createSpy('execute').and.returnValues(firstResult, secondResult),
      reset: jasmine.createSpy('reset'),
    };
    component.type = 'recaptcha-v2';
    component.siteKey = 'first-site-key';
    component.size = 'invisible';
    await initializeComponent();

    const firstExecution = component.execute();
    component.siteKey = 'second-site-key';
    component.ngOnChanges({
      siteKey: new SimpleChange('first-site-key', 'second-site-key', false),
    });
    await expectAsync(firstExecution).toBeRejectedWithError(
      'Captcha component reinitialized before execution completed',
    );
    await (component as any).initializationTask;

    const secondExecution = component.execute();
    resolveFirst('stale-token');
    await Promise.resolve();
    await Promise.resolve();
    expect(component.resolved.emit).not.toHaveBeenCalled();

    resolveSecond('fresh-token');
    await expectAsync(secondExecution).toBeResolvedTo('fresh-token');
    expect(component.resolved.emit).toHaveBeenCalledOnceWith('fresh-token');
  });

  it('ignores stale provider initialization after inputs change', async () => {
    createComponent();
    let resolveFirstLoad!: () => void;
    captchaService.loadScript.and.returnValues(
      new Promise<void>(resolve => resolveFirstLoad = resolve),
      Promise.resolve(),
    );
    const render = jasmine.createSpy('render').and.returnValue(8);
    (window as any).grecaptcha = { render, reset: jasmine.createSpy('reset') };
    component.type = 'recaptcha-v2';
    component.siteKey = 'first-site-key';

    const firstInitialization = initializeComponent();
    component.siteKey = 'second-site-key';
    component.ngOnChanges({
      siteKey: new SimpleChange('first-site-key', 'second-site-key', false),
    });
    await (component as any).initializationTask;
    resolveFirstLoad();
    await firstInitialization;

    expect(render).toHaveBeenCalledOnceWith(
      jasmine.any(HTMLElement),
      jasmine.objectContaining({ sitekey: 'second-site-key' }),
    );
  });

  it('does not render after being destroyed while a provider script is loading', async () => {
    createComponent();
    let resolveScript!: () => void;
    captchaService.loadScript.and.returnValue(new Promise<void>(resolve => {
      resolveScript = resolve;
    }));
    (window as any).grecaptcha = {
      render: jasmine.createSpy('render').and.returnValue(7),
      reset: jasmine.createSpy('reset'),
    };

    component.type = 'recaptcha-v2';
    component.siteKey = 'site-key';

    const initPromise = initializeComponent();
    component.ngOnDestroy();
    resolveScript();
    await initPromise;

    expect((window as any).grecaptcha.render).not.toHaveBeenCalled();
  });
});

describe('CaptchaService', () => {
  afterEach(() => {
    delete (window as any).grecaptcha;
    delete (window as any).turnstile;
    delete (window as any).initAliyunCaptcha;
    delete (window as any).AliyunCaptchaConfig;
    delete (window as any).existingCallback;
    delete (window as any).sharedCallback;
    delete (window as any).neverCalled;
    delete (window as any).lateCallback;
    delete (window as any).timedOutCallback;
  });

  it('waits for script.onload before resolving scripts without provider callbacks', async () => {
    let appendedScript: any;
    const fakeDocument = {
      createElement: jasmine.createSpy('createElement').and.returnValue({}),
      body: {
        appendChild: jasmine.createSpy('appendChild').and.callFake((script: any) => {
          appendedScript = script;
        }),
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    const promise = service.loadScript('https://example.test/script.js');
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBeFalse();
    expect(fakeDocument.body.appendChild).toHaveBeenCalledTimes(1);

    appendedScript.onload();
    await promise;

    expect(resolved).toBeTrue();
  });

  it('deduplicates scripts while the first load is still pending', () => {
    const fakeDocument = {
      createElement: jasmine.createSpy('createElement').and.returnValue({}),
      body: {
        appendChild: jasmine.createSpy('appendChild'),
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    const first = service.loadScript('https://example.test/script.js');
    const second = service.loadScript('https://example.test/script.js');

    expect(second).toBe(first);
    expect(fakeDocument.body.appendChild).toHaveBeenCalledTimes(1);
  });

  it('rejects a callback change for the same pending script instead of silently ignoring it', async () => {
    let appendedScript: any;
    const fakeDocument = {
      createElement: () => ({ dataset: {}, remove: jasmine.createSpy('remove') }),
      body: {
        appendChild: jasmine.createSpy('appendChild').and.callFake((script: any) => {
          appendedScript = script;
        }),
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    const first = service.loadScript('https://example.test/same-script.js');
    const second = service.loadScript('https://example.test/same-script.js', 'lateCallback');

    expect(second).not.toBe(first);
    await expectAsync(second).toBeRejectedWithError(
      'https://example.test/same-script.js is already loading with callback="none"; cannot request callback="lateCallback"',
    );
    expect((window as any).lateCallback).toBeUndefined();
    expect(fakeDocument.body.appendChild).toHaveBeenCalledTimes(1);

    appendedScript.onload();
    await expectAsync(first).toBeResolved();
  });

  it('times out and cleans up a newly appended script that never settles', async () => {
    const remove = jasmine.createSpy('remove');
    const appendedScripts: any[] = [];
    const fakeDocument = {
      createElement: () => ({ dataset: {}, remove }),
      body: {
        appendChild: jasmine.createSpy('appendChild').and.callFake((script: any) => {
          appendedScripts.push(script);
        }),
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    jasmine.clock().install();
    try {
      const promise = service.loadScript('https://example.test/hanging-script.js', 'timedOutCallback');
      jasmine.clock().tick(15001);

      await expectAsync(promise).toBeRejectedWithError(
        'Timed out loading CAPTCHA script: https://example.test/hanging-script.js',
      );
      expect(remove).toHaveBeenCalledTimes(1);
      expect((window as any).timedOutCallback).toBeUndefined();

      const retry = service.loadScript('https://example.test/hanging-script.js');
      expect(appendedScripts.length).toBe(2);
      appendedScripts[1].onload();
      await expectAsync(retry).toBeResolved();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('omits the Google hl parameter when language is auto', async () => {
    let appendedScript: any;
    const fakeDocument = {
      createElement: jasmine.createSpy('createElement').and.returnValue({}),
      body: {
        appendChild: jasmine.createSpy('appendChild').and.callFake((script: any) => {
          appendedScript = script;
        }),
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    const promise = service.loadScript('https://www.google.com/recaptcha/api.js?render=explicit', undefined, 'auto');

    expect(appendedScript.src).toBe('https://www.google.com/recaptcha/api.js?render=explicit');
    appendedScript.onload();
    await promise;
  });

  it('deduplicates Google scripts across language variants', () => {
    const fakeDocument = {
      createElement: jasmine.createSpy('createElement').and.returnValue({}),
      body: {
        appendChild: jasmine.createSpy('appendChild'),
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    const first = service.loadScript('https://www.google.com/recaptcha/api.js?render=explicit', undefined, 'en');
    const second = service.loadScript('https://www.google.com/recaptcha/api.js?render=explicit', undefined, 'fr');

    expect(second).toBe(first);
    expect(fakeDocument.body.appendChild).toHaveBeenCalledTimes(1);
  });

  it('rejects incompatible Google render configurations without loading a second SDK', async () => {
    const fakeDocument = {
      createElement: jasmine.createSpy('createElement').and.callFake(() => ({ dataset: {} })),
      body: {
        appendChild: jasmine.createSpy('appendChild'),
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    const explicit = service.loadScript('https://www.google.com/recaptcha/api.js?render=explicit');
    const siteKey = service.loadScript('https://www.google.com/recaptcha/api.js?render=site-key');

    expect(siteKey).not.toBe(explicit);
    await expectAsync(siteKey).toBeRejectedWithError(
      'google-recaptcha is already loading or loaded with render="explicit"; cannot request render="site-key"',
    );
    expect(fakeDocument.body.appendChild).toHaveBeenCalledTimes(1);
  });

  it('rejects mixing implicit and explicit Turnstile script modes', async () => {
    let appendedScript: any;
    const fakeDocument = {
      createElement: () => ({ dataset: {}, remove: jasmine.createSpy('remove') }),
      body: {
        appendChild: jasmine.createSpy('appendChild').and.callFake((script: any) => {
          appendedScript = script;
        }),
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    const implicit = service.loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js');
    const explicit = service.loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');

    await expectAsync(explicit).toBeRejectedWithError(
      'cloudflare-turnstile is already loading or loaded with render="implicit"; cannot request render="explicit"',
    );
    expect(fakeDocument.body.appendChild).toHaveBeenCalledTimes(1);

    appendedScript.onload();
    await expectAsync(implicit).toBeResolved();
  });

  it('does not treat the Google ready queue shim as a loaded SDK', async () => {
    let appendedScript: any;
    (window as any).grecaptcha = { ready: (_callback: () => void) => undefined };
    const fakeDocument = {
      createElement: jasmine.createSpy('createElement').and.returnValue({ dataset: {} }),
      body: {
        appendChild: jasmine.createSpy('appendChild').and.callFake((script: any) => {
          appendedScript = script;
        }),
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    const promise = service.loadScript('https://www.google.com/recaptcha/api.js?render=explicit');
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBeFalse();
    expect(fakeDocument.body.appendChild).toHaveBeenCalledTimes(1);

    (window as any).grecaptcha = {
      ready: (callback: () => void) => callback(),
      render: () => 1,
      execute: () => Promise.resolve('token'),
    };
    appendedScript.onload();
    await promise;

    expect(resolved).toBeTrue();
  });

  it('resolves when a generic script already exists without a library loading marker', async () => {
    const existingScript = {
      src: 'https://example.test/already-loaded.js',
      dataset: {},
      readyState: 'complete',
      getAttribute: (name: string) => name === 'src' ? 'https://example.test/already-loaded.js' : null,
      addEventListener: jasmine.createSpy('addEventListener'),
    };
    const fakeDocument = {
      querySelectorAll: () => [existingScript],
      body: {
        appendChild: jasmine.createSpy('appendChild'),
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    await expectAsync(service.loadScript('https://example.test/already-loaded.js')).toBeResolved();

    expect(existingScript.addEventListener).not.toHaveBeenCalled();
    expect(fakeDocument.body.appendChild).not.toHaveBeenCalled();
  });

  it('waits for an existing generic script that is still loading', async () => {
    const listeners = new Map<string, EventListener>();
    const existingScript = {
      src: 'https://example.test/still-loading.js',
      dataset: {},
      getAttribute: (name: string) => name === 'src' ? 'https://example.test/still-loading.js' : null,
      addEventListener: jasmine.createSpy('addEventListener').and.callFake(
        (event: string, callback: EventListener) => listeners.set(event, callback),
      ),
    };
    const fakeDocument = {
      defaultView: {
        performance: {
          getEntriesByName: () => [],
        },
      },
      querySelectorAll: () => [existingScript],
      body: {
        appendChild: jasmine.createSpy('appendChild'),
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    const promise = service.loadScript('https://example.test/still-loading.js');
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBeFalse();
    expect(listeners.has('load')).toBeTrue();

    listeners.get('load')?.(new Event('load'));
    await promise;

    expect(resolved).toBeTrue();
    expect(fakeDocument.body.appendChild).not.toHaveBeenCalled();
  });

  it('does not treat an unrelated Resource Timing entry as proof that the current script loaded', async () => {
    const listeners = new Map<string, EventListener>();
    const existingScript = {
      src: 'https://example.test/resource-timing.js',
      dataset: {},
      getAttribute: (name: string) => name === 'src' ? 'https://example.test/resource-timing.js' : null,
      addEventListener: (event: string, callback: EventListener) => listeners.set(event, callback),
      removeEventListener: (event: string) => listeners.delete(event),
    };
    const fakeDocument = {
      defaultView: {
        performance: {
          getEntriesByName: () => [{}],
        },
      },
      querySelectorAll: () => [existingScript],
      body: {
        appendChild: jasmine.createSpy('appendChild'),
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    const promise = service.loadScript('https://example.test/resource-timing.js');
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBeFalse();
    expect(listeners.has('load')).toBeTrue();

    listeners.get('load')?.(new Event('load'));
    await expectAsync(promise).toBeResolved();
  });

  it('reserves callback ownership while waiting for an existing script', async () => {
    const listeners = new Map<string, EventListener>();
    const existingScript = {
      src: 'https://example.test/external.js',
      dataset: {},
      getAttribute: (name: string) => name === 'src' ? 'https://example.test/external.js' : null,
      addEventListener: (event: string, callback: EventListener) => listeners.set(event, callback),
      removeEventListener: (event: string) => listeners.delete(event),
    };
    const appendedScripts: any[] = [];
    const previousCallback = jasmine.createSpy('previousCallback');
    (window as any).sharedCallback = previousCallback;
    const fakeDocument = {
      querySelectorAll: () => [existingScript],
      createElement: () => ({ dataset: {} }),
      body: {
        appendChild: (script: any) => appendedScripts.push(script),
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    const existing = service.loadScript('https://example.test/external.js', 'sharedCallback');
    const competing = service.loadScript('https://example.test/competing.js', 'sharedCallback');

    await expectAsync(competing).toBeRejectedWithError(
      'CAPTCHA script callback "sharedCallback" is already in use',
    );
    expect(appendedScripts.length).toBe(0);

    (window as any).sharedCallback('value');
    await expectAsync(existing).toBeResolved();
    expect(previousCallback).toHaveBeenCalledOnceWith('value');
    expect((window as any).sharedCallback).toBe(previousCallback);
    expect(listeners.has('load')).toBeFalse();
  });

  it('loads a replacement when a discovered external script has failed', async () => {
    const listeners = new Map<string, EventListener>();
    const failedScript = {
      src: 'https://example.test/retry-external.js',
      dataset: {},
      getAttribute: (name: string) => name === 'src' ? 'https://example.test/retry-external.js' : null,
      addEventListener: (event: string, callback: EventListener) => listeners.set(event, callback),
      removeEventListener: (event: string) => listeners.delete(event),
    };
    let replacementScript: any;
    const fakeDocument = {
      querySelectorAll: () => [failedScript],
      createElement: () => ({ dataset: {} }),
      body: {
        appendChild: jasmine.createSpy('appendChild').and.callFake((script: any) => {
          replacementScript = script;
        }),
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    const first = service.loadScript('https://example.test/retry-external.js');
    listeners.get('error')?.(new Event('error'));
    await expectAsync(first).toBeRejected();

    const retry = service.loadScript('https://example.test/retry-external.js');
    expect(fakeDocument.body.appendChild).toHaveBeenCalledTimes(1);
    expect(replacementScript).toBeDefined();
    replacementScript.onload();

    await expectAsync(retry).toBeResolved();
  });

  it('rejects concurrent loads that reuse the same provider callback name', async () => {
    const appendedScripts: any[] = [];
    const fakeDocument = {
      querySelectorAll: () => [],
      createElement: () => ({ dataset: {} }),
      body: {
        appendChild: (script: any) => appendedScripts.push(script),
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    const first = service.loadScript('https://example.test/first.js', 'sharedCallback');
    const second = service.loadScript('https://example.test/second.js', 'sharedCallback');

    await expectAsync(second).toBeRejectedWithError(
      'CAPTCHA script callback "sharedCallback" is already in use',
    );
    expect(appendedScripts.length).toBe(1);

    appendedScripts[0].onload();
    await expectAsync(first).toBeResolved();
    expect((window as any).sharedCallback).toBeUndefined();
  });

  it('settles a named script load when onload fires without the provider callback', async () => {
    let appendedScript: any;
    const fakeDocument = {
      querySelectorAll: () => [],
      createElement: () => ({ dataset: {} }),
      body: {
        appendChild: (script: any) => {
          appendedScript = script;
        },
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    const promise = service.loadScript('https://example.test/no-callback.js', 'neverCalled');
    appendedScript.onload();

    await expectAsync(promise).toBeResolved();
    expect((window as any).neverCalled).toBeUndefined();
  });

  it('settles and restores a provider callback even when the previous callback throws', async () => {
    let appendedScript: any;
    const previousCallback = jasmine.createSpy('previousCallback').and.throwError('host callback failed');
    (window as any).existingCallback = previousCallback;
    const fakeDocument = {
      querySelectorAll: () => [],
      createElement: () => ({ dataset: {} }),
      body: {
        appendChild: (script: any) => {
          appendedScript = script;
        },
      },
    };
    const service = new CaptchaService(fakeDocument as any, 'browser');

    const promise = service.loadScript('https://example.test/callback.js', 'existingCallback');
    expect(() => (window as any).existingCallback('value')).toThrowError('host callback failed');

    await expectAsync(promise).toBeResolved();
    expect(previousCallback).toHaveBeenCalledOnceWith('value');
    expect((window as any).existingCallback).toBe(previousCallback);
    expect(appendedScript).toBeDefined();
  });

  it('does not cache a host lookup failure and allows a later retry', async () => {
    let appendedScript: any;
    const fakeDocument: any = {
      querySelectorAll: () => [],
      createElement: () => ({ dataset: {} }),
    };
    const service = new CaptchaService(fakeDocument, 'browser');

    await expectAsync(service.loadScript('https://example.test/retry.js'))
      .toBeRejectedWithError('Unable to find a document host for the CAPTCHA script');

    fakeDocument.body = {
      appendChild: (script: any) => {
        appendedScript = script;
      },
    };
    const retry = service.loadScript('https://example.test/retry.js');
    expect(appendedScript).toBeDefined();
    appendedScript.onload();

    await expectAsync(retry).toBeResolved();
  });

  it('rejects provider execution outside the browser', async () => {
    const service = new CaptchaService({} as any, 'server');

    await expectAsync(service.executeRecaptchaV3('site-key', 'submit'))
      .toBeRejectedWithError('reCAPTCHA v3 execution is only available in a browser');
    await expectAsync(service.executeTurnstile('site-key'))
      .toBeRejectedWithError('Turnstile execution is only available in a browser');
    await expectAsync(service.executeAlibabaCaptcha('scene-id', {
      element: '#captcha-element',
      button: '#submit-button',
      captchaVerifyCallback: () => ({ captchaResult: true }),
      prefix: 'prefix',
    })).toBeRejectedWithError('Alibaba Captcha 2.0 execution is only available in a browser');
  });

  it('creates container ids from the service instance', () => {
    const firstService = new CaptchaService({} as any, 'browser');
    const secondService = new CaptchaService({} as any, 'browser');

    expect(firstService.createContainerId()).toBe('captcha-container-0');
    expect(firstService.createContainerId()).toBe('captcha-container-1');
    expect(secondService.createContainerId()).toBe('captcha-container-0');
  });

  it('reuses an explicitly rendered reCAPTCHA v3 widget across service executions', async () => {
    const service = new CaptchaService(document, 'browser');
    spyOn(service, 'loadScript').and.resolveTo();
    let renderedContainer: HTMLElement | undefined;
    (window as any).grecaptcha = {
      ready: (callback: () => void) => callback(),
      render: jasmine.createSpy('render').and.callFake((container: HTMLElement) => {
        renderedContainer = container;
        return 23;
      }),
      execute: jasmine.createSpy('execute').and.callFake((_widgetId: number, options: { action: string }) => (
        Promise.resolve(`${options.action}-token`)
      )),
      reset: jasmine.createSpy('reset'),
    };

    const firstToken = await service.executeRecaptchaV3('site-key', 'first', 'en');
    const secondToken = await service.executeRecaptchaV3('site-key', 'second', 'en');

    expect(firstToken).toBe('first-token');
    expect(secondToken).toBe('second-token');
    expect(service.loadScript).toHaveBeenCalledTimes(2);
    expect(service.loadScript).toHaveBeenCalledWith(
      'https://www.google.com/recaptcha/api.js?render=explicit',
      undefined,
      'en',
    );
    expect((window as any).grecaptcha.render).toHaveBeenCalledWith(
      jasmine.any(HTMLElement),
      { sitekey: 'site-key', size: 'invisible' },
    );
    expect((window as any).grecaptcha.render).toHaveBeenCalledTimes(1);
    expect((window as any).grecaptcha.execute).toHaveBeenCalledWith(23, { action: 'first' });
    expect((window as any).grecaptcha.execute).toHaveBeenCalledWith(23, { action: 'second' });
    expect((window as any).grecaptcha.execute).toHaveBeenCalledTimes(2);
    expect((window as any).grecaptcha.reset).not.toHaveBeenCalled();
    expect(renderedContainer?.isConnected).toBeTrue();
    expect(renderedContainer?.hidden).toBeFalse();

    service.ngOnDestroy();

    expect((window as any).grecaptcha.reset).toHaveBeenCalledOnceWith(23);
    expect(renderedContainer?.isConnected).toBeFalse();
  });

  it('renders Turnstile into a custom element when executing through the service', async () => {
    const service = new CaptchaService({} as any, 'browser');
    spyOn(service, 'loadScript').and.resolveTo();
    const customElement = document.createElement('div');
    let renderOptions: any;
    let nextWidgetId = 0;
    (window as any).turnstile = {
      ready: (callback: () => void) => callback(),
      render: jasmine.createSpy('render').and.callFake((_element: HTMLElement, options: any) => {
        renderOptions = options;
        nextWidgetId += 1;
        return `widget-${nextWidgetId}`;
      }),
      remove: jasmine.createSpy('remove'),
    };

    const promise = service.executeTurnstile('site-key', 'submit', 'payload', customElement);
    await Promise.resolve();
    await Promise.resolve();

    renderOptions.callback('turnstile-token');
    const token = await promise;

    expect(token).toBe('turnstile-token');
    expect((window as any).turnstile.render).toHaveBeenCalledOnceWith(customElement, jasmine.objectContaining({
      sitekey: 'site-key',
      action: 'submit',
      cData: 'payload',
    }));
    expect((window as any).turnstile.remove).toHaveBeenCalledOnceWith('widget-1');

    const secondPromise = service.executeTurnstile('site-key', 'submit', 'payload', customElement);
    await Promise.resolve();
    await Promise.resolve();
    renderOptions.callback('second-token');

    await expectAsync(secondPromise).toBeResolvedTo('second-token');
    expect((window as any).turnstile.render).toHaveBeenCalledTimes(2);
    expect((window as any).turnstile.remove).toHaveBeenCalledWith('widget-2');
    expect((window as any).turnstile.remove).toHaveBeenCalledTimes(2);

    const errorPromise = service.executeTurnstile('site-key', 'submit', 'payload', customElement);
    await Promise.resolve();
    await Promise.resolve();
    expect(renderOptions['error-callback']('turnstile-error')).toBeTrue();
    await expectAsync(errorPromise).toBeRejectedWith('turnstile-error');
    expect((window as any).turnstile.remove).toHaveBeenCalledWith('widget-3');
    expect((window as any).turnstile.remove).toHaveBeenCalledTimes(3);
  });

  it('initializes Alibaba Captcha 2.0 through the service', async () => {
    const service = new CaptchaService({} as any, 'browser');
    spyOn(service, 'loadScript').and.resolveTo();
    const verifyCallback = jasmine.createSpy('verifyCallback').and.returnValue({ captchaResult: true });
    const onBizResultCallback = jasmine.createSpy('onBizResultCallback');
    const getInstance = jasmine.createSpy('getInstance');
    let initOptions: any;
    (window as any).initAliyunCaptcha = jasmine.createSpy('initAliyunCaptcha').and.callFake((options: any) => {
      initOptions = options;
    });

    await service.executeAlibabaCaptcha('scene-id', {
      mode: 'embed',
      element: '#captcha-element',
      button: '#submit-button',
      captchaVerifyCallback: verifyCallback,
      onBizResultCallback,
      getInstance,
      language: 'tw',
      region: 'cn',
      prefix: 'prefix',
      slideStyle: { width: 360, height: 40 },
      immediate: false,
      timeout: 5000,
      rem: 1,
      autoRefresh: true,
      captchaLogoImg: 'logo-url',
    });

    expect((window as any).AliyunCaptchaConfig).toEqual({ region: 'cn', prefix: 'prefix' });
    expect(initOptions).toEqual(jasmine.objectContaining({
      SceneId: 'scene-id',
      mode: 'embed',
      element: '#captcha-element',
      button: '#submit-button',
      captchaVerifyCallback: verifyCallback,
      onBizResultCallback,
      getInstance,
      language: 'tw',
      slideStyle: { width: 360, height: 40 },
      immediate: false,
      timeout: 5000,
      rem: 1,
      autoRefresh: true,
      captchaLogoImg: 'logo-url',
    }));
  });

  it('uses default Alibaba service callbacks and normalizes language aliases', async () => {
    const service = new CaptchaService({} as any, 'browser');
    spyOn(service, 'loadScript').and.resolveTo();
    let initOptions: any;
    (window as any).initAliyunCaptcha = jasmine.createSpy('initAliyunCaptcha').and.callFake((options: any) => {
      initOptions = options;
    });

    await service.executeAlibabaCaptcha('scene-id', {
      element: '#captcha-element',
      button: '#submit-button',
      captchaVerifyCallback: () => ({ captchaResult: true }),
      language: 'zh-TW',
      prefix: 'prefix',
    });

    expect(initOptions.language).toBe('tw');
    expect(typeof initOptions.onBizResultCallback).toBe('function');
    expect(typeof initOptions.getInstance).toBe('function');
  });

  it('runtime-validates a string-valued Alibaba service region', async () => {
    const service = new CaptchaService(document, 'browser');

    await expectAsync(service.executeAlibabaCaptcha('scene-id', {
      element: '#captcha-element',
      button: '#submit-button',
      captchaVerifyCallback: () => ({ captchaResult: true }),
      prefix: 'prefix',
      region: 'invalid-region',
    })).toBeRejectedWithError('Alibaba Captcha 2.0 region must be "cn" or "sgp"');
  });

  it('rejects incompatible Alibaba SDK configuration after the script is shared', async () => {
    const service = new CaptchaService(document, 'browser');
    spyOn(service, 'loadScript').and.resolveTo();
    (window as any).initAliyunCaptcha = jasmine.createSpy('initAliyunCaptcha');
    const baseOptions = {
      element: '#captcha-element',
      button: '#submit-button',
      captchaVerifyCallback: () => ({ captchaResult: true }),
      prefix: 'prefix',
    };

    await service.executeAlibabaCaptcha('scene-id', baseOptions);

    await expectAsync(service.executeAlibabaCaptcha('scene-id', {
      ...baseOptions,
      region: 'sgp',
      prefix: 'other-prefix',
    })).toBeRejectedWithError(
      'Alibaba CAPTCHA SDK is already configured with region="cn" and prefix="prefix"; '
      + 'cannot request region="sgp" and prefix="other-prefix"',
    );
    expect(service.loadScript).toHaveBeenCalledTimes(1);
    expect((window as any).initAliyunCaptcha).toHaveBeenCalledTimes(1);
  });

  it('detects in-place mutation of the Alibaba global configuration', async () => {
    const service = new CaptchaService(document, 'browser');
    spyOn(service, 'loadScript').and.resolveTo();

    await service.loadAlibabaScript('cn', 'prefix');
    (window as any).AliyunCaptchaConfig.region = 'sgp';

    await expectAsync(service.loadAlibabaScript('sgp', 'prefix')).toBeRejectedWithError(
      'Alibaba CAPTCHA global configuration changed after the SDK was configured',
    );
    expect(service.loadScript).toHaveBeenCalledTimes(1);
  });
});
