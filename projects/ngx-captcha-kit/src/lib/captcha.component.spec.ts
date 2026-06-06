import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ElementRef } from '@angular/core';
import { CaptchaComponent } from './captcha.component';
import { CaptchaService } from './captcha.service';

class MockCaptchaService {
  loadScript = jasmine.createSpy('loadScript').and.returnValue(Promise.resolve());
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

  it('executes reCAPTCHA v3 after the script is ready', async () => {
    createComponent();
    spyOn(component.resolved, 'emit');
    (window as any).grecaptcha = {
      ready: (callback: () => void) => callback(),
      execute: jasmine.createSpy('execute').and.resolveTo('v3-token'),
    };

    component.type = 'recaptcha-v3';
    component.siteKey = 'site-key';
    component.action = 'submit';

    await initializeComponent();

    const token = await component.execute();

    expect(token).toBe('v3-token');
    expect((window as any).grecaptcha.execute).toHaveBeenCalledOnceWith('site-key', { action: 'submit' });
    expect(component.resolved.emit).toHaveBeenCalledOnceWith('v3-token');
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

  it('renders Turnstile without a component-level global callback', async () => {
    createComponent();
    (window as any).turnstile = {
      ready: (callback: () => void) => callback(),
      render: jasmine.createSpy('render').and.returnValue('widget-id'),
      remove: jasmine.createSpy('remove'),
    };

    component.type = 'turnstile';
    component.siteKey = 'site-key';
    component.action = 'submit';

    await initializeComponent();

    expect((window as any).turnstile.render).toHaveBeenCalled();
    expect((window as any).turnstileOnload).toBeUndefined();
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

  it('rejects unsupported Alibaba float mode', async () => {
    createComponent();
    spyOn(component.error, 'emit');

    component.type = 'alibaba';
    component.sceneId = 'scene-id';
    component.prefix = 'prefix';
    component.mode = 'float';
    component.button = '#login-button';
    component.captchaVerifyCallback = () => ({ captchaResult: true });

    await initializeComponent();

    expect(component.error.emit).toHaveBeenCalledOnceWith('Alibaba Captcha 2.0 supports only "embed" or "popup" mode');
    expect(captchaService.loadScript).not.toHaveBeenCalled();
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
    delete (window as any).turnstile;
    delete (window as any).initAliyunCaptcha;
    delete (window as any).AliyunCaptchaConfig;
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
    const service = new CaptchaService(fakeDocument, 'browser');

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
    const service = new CaptchaService(fakeDocument, 'browser');

    const first = service.loadScript('https://example.test/script.js');
    const second = service.loadScript('https://example.test/script.js');

    expect(second).toBe(first);
    expect(fakeDocument.body.appendChild).toHaveBeenCalledTimes(1);
  });

  it('creates container ids from the service instance', () => {
    const firstService = new CaptchaService({} as any, 'browser');
    const secondService = new CaptchaService({} as any, 'browser');

    expect(firstService.createContainerId()).toBe('captcha-container-0');
    expect(firstService.createContainerId()).toBe('captcha-container-1');
    expect(secondService.createContainerId()).toBe('captcha-container-0');
  });

  it('renders Turnstile into a custom element when executing through the service', async () => {
    const service = new CaptchaService({} as any, 'browser');
    spyOn(service, 'loadScript').and.resolveTo();
    const customElement = document.createElement('div');
    let renderOptions: any;
    (window as any).turnstile = {
      ready: (callback: () => void) => callback(),
      render: jasmine.createSpy('render').and.callFake((_element: HTMLElement, options: any) => {
        renderOptions = options;
      }),
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
});
