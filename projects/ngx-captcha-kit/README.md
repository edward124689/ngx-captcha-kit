# ngx-captcha-kit
[![npm version](https://badge.fury.io/js/ngx-captcha-kit.svg)](https://www.npmjs.com/package/ngx-captcha-kit) [![npm downloads](https://img.shields.io/npm/dm/ngx-captcha-kit.svg)](https://www.npmjs.com/package/ngx-captcha-kit) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An Angular library that provides a unified integration for multiple CAPTCHA services in Angular applications. Supports Google reCAPTCHA v2 (Checkbox and Invisible) and v3, Cloudflare Turnstile, and Alibaba Cloud Captcha 2.0, with a modular architecture for easy expansion. This kit simplifies CAPTCHA implementation with a single component and service, ensuring compatibility with modern Angular features like Signals and zoneless change detection.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Version Support](#version-support)
- [Usage](#usage)
  - [Importing the Module](#importing-the-module)
  - [General CAPTCHA Component](#general-captcha-component)
  - [reCAPTCHA v2](#recaptcha-v2)
  - [reCAPTCHA v3](#recaptcha-v3)
  - [Cloudflare Turnstile](#cloudflare-turnstile)
  - [Alibaba Cloud Captcha 2.0](#alibaba-cloud-captcha-20)
  - [Language Customization](#language-customization)
  - [Error Handling and Best Practices](#error-handling-and-best-practices)
- [API Reference](#api-reference)
- [Configuration Options](#configuration-options)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Unified Interface**: A single `<captcha-kit>` component handles all CAPTCHA types via input parameters.
- **Multi-Provider Support**:
  - Google reCAPTCHA v2 (visible checkbox/invisible) and v3 (score-based invisible).
  - Cloudflare Turnstile (invisible or interactive widget with score-based verification).
  - Alibaba Cloud Captcha 2.0 (no-trace validation, one-click pass, slider validation, jigsaw validation, and image restoration via embed/popup modes).
- **Dynamic Script Loading**: Loads each provider script on-demand, reuses existing provider globals, and keeps component rendering SSR-safe.
- **Language Support**: Customizable language via input (e.g., 'en', 'zh-TW', 'auto').
- **Extensible Design**: Easily add new CAPTCHA providers by extending the service and component.
- **Angular 22 Compatibility**: Supports modern Angular APIs, zoneless apps, and avoids unnecessary Zone.js dependencies.
- **TypeScript Support**: Full typings for improved developer experience.

## Installation

Install the library via npm:

```bash
npm install ngx-captcha-kit
```

For scoped packages (if published under a namespace):

```bash
npm install @your-username/ngx-captcha-kit
```

Ensure your project uses Angular 22. Peer dependencies: `@angular/core` and `@angular/common` at `^22.0.0` or newer Angular 22 patch versions.

## Version Support

| ngx-captcha-kit version | Supported Angular version |
| --- | --- |
| `22.x` | Angular `22.x` |
| `21.x` | Angular `21.x` |
| `20.x` | Angular `20.x` |

## Usage

### Importing the Module

Import `NgxCaptchaKitModule` in your Angular module (e.g., `app.module.ts`):

```typescript
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { NgxCaptchaKitModule } from 'ngx-captcha-kit';

import { AppComponent } from './app.component';

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, NgxCaptchaKitModule],
  bootstrap: [AppComponent]
})
export class AppModule { }
```

### General CAPTCHA Component

Use the `<captcha-kit>` component and specify the `type` input to select the provider. All providers emit a `resolved` event with the token or verification param, which must be sent to your backend for validation.

Obtain keys/credentials:
- Google reCAPTCHA: From [Google reCAPTCHA Admin](https://www.google.com/recaptcha/admin).
- Cloudflare Turnstile: From Cloudflare Dashboard.
- Alibaba Cloud Captcha: From Alibaba Cloud Console (SceneId, prefix, and region).

### reCAPTCHA v2

For visible checkbox or invisible modes. Invisible v2 can be triggered manually with `execute()`.

Template:
```html
<captcha-kit
  type="recaptcha-v2"
  [siteKey]="'YOUR_SITE_KEY'"
  [theme]="'light'"
  [size]="'normal'"
  [language]="'en'"
  (resolved)="onResolved($event)"
  (error)="onError($event)">
</captcha-kit>
```

Component:
```typescript
onResolved(token: string) {
  // Send token to backend
}
```

### reCAPTCHA v3

Invisible, score-based verification. For v3, use the service directly or the component for pre-loading the script, but execute manually (e.g., in form submit) to generate fresh tokens.

**Using Service (Recommended for v3):**
No template needed.

Component code:
```typescript
import { Component } from '@angular/core';
import { CaptchaService } from 'ngx-captcha-kit';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-form',
  template: `
    <form (ngSubmit)="onSubmit()">
      <!-- form fields -->
      <button type="submit">Submit</button>
    </form>
  `
})
export class FormComponent {
  constructor(private captchaService: CaptchaService, private http: HttpClient) {}

  async onSubmit() {
    try {
      const token = await this.captchaService.executeRecaptchaV3('YOUR_SITE_KEY', 'submit', 'zh-TW');
      this.http.post('/api/submit', { /* form data */, token }).subscribe(response => {
        console.log('Success:', response);
      });
    } catch (error) {
      console.error('v3 error:', error);
    }
  }
}
```

**Using Component for Pre-loading:**
Template:
```html
<captcha-kit
  #v3Captcha
  type="recaptcha-v3"
  [siteKey]="'YOUR_SITE_KEY'"
  [action]="'submit'"
  [language]="'en'"
  (error)="onError($event)">
</captcha-kit>
```

Component code:
```typescript
import { ViewChild } from '@angular/core';
import { CaptchaComponent } from 'ngx-captcha-kit';

@ViewChild('v3Captcha') v3Captcha!: CaptchaComponent;

async onSubmit() {
  const token = await this.v3Captcha.execute();
  // Send token
}
```

Best practices: Execute on sensitive actions (e.g., login, submit); tokens expire after about 2 minutes; analyze scores in admin console (threshold e.g., 0.5).

### Cloudflare Turnstile

Invisible or interactive. Use explicit rendering for control.

Template:
```html
<captcha-kit
  #turnstileCaptcha
  type="turnstile"
  [siteKey]="'YOUR_SITE_KEY'"
  [action]="'submit'"
  [theme]="'auto'"
  [size]="'flexible'"
  [language]="'fr'"
  [cData]="'custom-data'"
  (resolved)="onResolved($event)"
  (expired)="onExpired()"
  (timedOut)="onTimedOut()">
</captcha-kit>
```

Backend verifies via Cloudflare's siteverify API.

For deferred execution, set `execution="execute"`, optionally set `appearance="execute"`, then call the component's `execute()` method when the protected action occurs:

```typescript
@ViewChild('turnstileCaptcha') turnstileCaptcha!: CaptchaComponent;

async onSubmit() {
  const token = await this.turnstileCaptcha.execute();
  // Send the token to your backend immediately.
}
```

### Alibaba Cloud Captcha 2.0

Alibaba Cloud Captcha 2.0 supports no-trace validation, one-click pass, slider validation, jigsaw validation, and image restoration. The exact verification shape is configured in the Alibaba Cloud scene/risk policy, so the Angular integration uses the same V2 initialization path for all shapes.

For no-trace validation, use `mode="popup"` because Alibaba Cloud Captcha 2.0 does not support no-trace validation in embedded mode.

Template:
```html
<button id="login-button" type="button">Login</button>

<captcha-kit
  type="alibaba"
  [sceneId]="'YOUR_SCENE_ID'"
  [prefix]="'YOUR_PREFIX'"
  [region]="'cn'"
  [mode]="'popup'"
  [button]="'#login-button'"
  [captchaVerifyCallback]="verifyAlibabaCaptcha"
  [slideStyle]="{ width: 360, height: 40 }"
  [language]="'en'"
  (resolved)="onAlibabaParam($event)"
  (bizResult)="onAlibabaBizResult($event)"
  (error)="onError($event)">
</captcha-kit>
```

Component:
```typescript
import { HttpClient } from '@angular/common/http';
import { Component } from '@angular/core';
import { AlibabaCaptchaVerifyResult } from 'ngx-captcha-kit';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
})
export class LoginComponent {
  constructor(private http: HttpClient) {}

  verifyAlibabaCaptcha = async (captchaVerifyParam: string): Promise<AlibabaCaptchaVerifyResult> => {
    const result = await firstValueFrom(this.http.post<{
      captchaVerifyResult: boolean;
      bizResult?: boolean;
    }>('/api/verify-alibaba-captcha', {
      captchaVerifyParam,
      // Include your business params here, for example username/password or form id.
    }));

    return {
      captchaResult: result.captchaVerifyResult,
      bizResult: result.bizResult,
    };
  };

  onAlibabaParam(captchaVerifyParam: string) {
    // Optional: the same param is passed to verifyAlibabaCaptcha.
  }

  onAlibabaBizResult(bizResult: boolean | undefined) {
    // Continue or reject the business flow based on your backend response.
  }
}
```

`captchaVerifyCallback` must call your backend and return `{ captchaResult: boolean, bizResult?: boolean }`. The backend should call Alibaba Cloud `VerifyIntelligentCaptcha`; do not trust browser-only verification.

### Language Customization

All providers support language customization via the `language` input (e.g., 'en', 'zh', 'zh-TW', 'auto'). For Alibaba Cloud Captcha 2.0, language aliases are normalized to `cn`, `tw`, or `en`. Defaults to 'auto' (browser detection where supported).

### Error Handling and Best Practices

- Handle `(error)` output for script failures, invalid keys, or timeouts.
- Always verify tokens server-side to prevent bypassing.
- SSR: Scripts won't load on server.
- Direct service execution on the server rejects with a descriptive browser-only error instead of touching browser globals.
- Google reCAPTCHA uses one explicit-render script so v2, v3, and multiple site keys can share a page. The first requested Google language applies to all reCAPTCHA widgets on that page; direct `loadScript()` calls with an incompatible Google `render` configuration reject instead of loading a second SDK copy.
- Dynamic script loads settle when either the provider callback or the script `load` event fires, and reject after 15 seconds if a newly appended script never settles. A pending load must keep the same callback choice for the same script; different concurrent scripts must use distinct callback names.
- Quotas: Monitor provider limits (e.g., Google 1M/month free).
- For v3/Turnstile: Generate tokens on actions to avoid expiration.

## API Reference

### CaptchaService

- `loadScript(url: string, onloadCallbackName?: string, language?: string): Promise<void>`: Loads scripts dynamically.
- `executeRecaptchaV3(siteKey: string, action: string, language?: string): Promise<string>`
- `executeTurnstile(siteKey: string, action?: string, cData?: string, element?: string | HTMLElement): Promise<string>` (removes its temporary widget after success or failure)
- `executeAlibabaCaptcha(sceneId: string, options: AlibabaCaptchaOptions): Promise<void>`

### CaptchaComponent

- **Inputs**:
  - `type: 'recaptcha-v2' | 'recaptcha-v3' | 'turnstile' | 'alibaba'`
  - `siteKey?: string` (for Google/Cloudflare)
  - `sceneId?: string` (for Alibaba)
  - `prefix?: string` (for Alibaba Captcha 2.0)
  - `region?: string` (for Alibaba Captcha 2.0, defaults to `cn`)
  - `action?: string`
  - `theme?: 'light' | 'dark' | 'auto'` (`auto` follows the system theme for reCAPTCHA and is passed through to Turnstile)
  - `size?: 'normal' | 'compact' | 'invisible' | 'flexible'` (`flexible` is for Turnstile; `invisible` is for reCAPTCHA v2)
  - `mode?: 'embed' | 'popup'` (for Alibaba Captcha 2.0)
  - `cData?: string` (Turnstile)
  - `language?: string` (defaults to 'auto')
  - `execution?: 'render' | 'execute'` (Turnstile, defaults to `render`)
  - `appearance?: 'always' | 'execute' | 'interaction-only'` (Turnstile)
  - `button?: string` (Alibaba Captcha 2.0 trigger selector)
  - `captchaVerifyCallback?: AlibabaCaptchaVerifyCallback`
  - `onBizResultCallback?: (bizResult: boolean | undefined) => void`
  - `getInstance?: (instance: any) => void`
  - `slideStyle?: { width?: number; height?: number }`
  - `immediate?: boolean`
  - `timeout?: number`
  - `rem?: number`
  - `autoRefresh?: boolean`
  - `captchaLogoImg?: string`
  - `alibabaOnError?: (error: any) => void`
- **Outputs**:
  - `resolved: EventEmitter<string | any>`
  - `error: EventEmitter<any>`
  - `bizResult: EventEmitter<boolean | undefined>`
  - `expired: EventEmitter<void>` (Turnstile)
  - `timedOut: EventEmitter<void>` (Turnstile)
- **Methods**:
  - `execute(): Promise<string>` (for reCAPTCHA v2 invisible, reCAPTCHA v3, and Turnstile with `execution="execute"`)

## Configuration Options

Customize via component inputs. For advanced needs, extend the service.

## Contributing

Fork the repo, create a branch, and submit a PR.

- Requirements: Node.js `^22.22.3`, `^24.15.0`, or `>=26.0.0`.
- Setup: `npm install`, then `npm run build`.
- Testing: Run `npm run test:ci`; use `npm run start` for the test app.
- Full local CI check: `npm run ci`.
- Issues: Report on GitHub.

## License

MIT License. See [LICENSE](LICENSE) for details.
