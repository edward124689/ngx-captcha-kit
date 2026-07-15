import { TestBed } from '@angular/core/testing';
import { CaptchaService } from 'ngx-captcha-kit';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    (window as any).turnstile = {
      ready: (callback: () => void) => callback(),
      render: jasmine.createSpy('render').and.returnValue('widget-id'),
      execute: jasmine.createSpy('execute'),
      remove: jasmine.createSpy('remove'),
    };
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{
        provide: CaptchaService,
        useValue: {
          createContainerId: () => 'test-captcha-container',
          loadScript: () => Promise.resolve(),
        },
      }],
    }).compileComponents();
  });

  afterEach(() => {
    delete (window as any).turnstile;
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('ngx-captcha-kit demo');
  });
});
