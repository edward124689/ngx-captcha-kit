import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NgxCaptchaKit } from './ngx-captcha-kit';

describe('NgxCaptchaKit', () => {
  let component: NgxCaptchaKit;
  let fixture: ComponentFixture<NgxCaptchaKit>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NgxCaptchaKit]
    })
    .compileComponents();

    fixture = TestBed.createComponent(NgxCaptchaKit);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
