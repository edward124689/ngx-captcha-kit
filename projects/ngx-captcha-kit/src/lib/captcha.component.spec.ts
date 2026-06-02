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
});
