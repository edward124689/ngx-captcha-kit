# ngx-captcha-kit
[![npm version](https://badge.fury.io/js/ngx-captcha-kit.svg)](https://www.npmjs.com/package/ngx-captcha-kit) [![npm downloads](https://img.shields.io/npm/dm/ngx-captcha-kit.svg)](https://www.npmjs.com/package/ngx-captcha-kit) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An Angular library that provides a unified integration for multiple CAPTCHA services in Angular applications. Supports Google reCAPTCHA v2 (Checkbox and Invisible) and v3, Cloudflare Turnstile, and Alibaba Cloud Captcha 2.0, with a modular architecture for easy expansion. This kit simplifies CAPTCHA implementation with a single component and service, ensuring compatibility with Angular 20+ features like Signals and zoneless change detection.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
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
  - Alibaba Cloud Captcha 2.0 (sliding puzzle, intelligent validation, embed/popup/float modes).
- **Dynamic Script Loading**: Loads provider scripts on-demand with SSR compatibility.
- **Language Support**: Customizable language via input (e.g., 'en', 'zh-TW', 'auto').
- **Extensible Design**: Easily add new CAPTCHA providers by extending the service and component.
- **Angular 20+ Compatibility**: Supports modern Angular APIs, zoneless apps, and avoids unnecessary Zone.js dependencies.
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

Ensure your project uses Angular 20 or higher. Peer dependencies: `@angular/core` and `@angular/common` at `^20.0.0`.

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
- Alibaba Cloud Captcha: From Alibaba Cloud Console (SceneId, etc.).

### reCAPTCHA v2

For visible checkbox or invisible modes.

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

Invisible, score-based verification. For v3, use the service directly or the component for pre-loading the script, but execute manually (e.g., in form submit) to generate fresh tokens.<grok:render card_id="f7e076" card_type="citation_card" type="render_inline_citation">
<argument name="citation_id">1</argument>
</grok:render>

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

@ViewChild('v3Captcha') v3Captcha: CaptchaComponent;

async onSubmit() {
  const token = await this.v3Captcha.execute();
  // Send token
}
```

Best practices: Execute on sensitive actions (e.g., login, submit); tokens expire after about 2 minutes; analyze scores in admin console (threshold e.g., 0.5).<grok:render card_id="d368c6" card_type="citation_card" type="render_inline_citation">
<argument name="citation_id">1</argument>
</grok:render>

### Cloudflare Turnstile

Invisible or interactive. Use explicit rendering for control.<grok:render card_id="0bdf3b" card_type="citation_card" type="render_inline_citation">
<argument name="citation_id">3</argument>
</grok:render>

Template:
```html
<captcha-kit
  type="turnstile"
  [siteKey]="'YOUR_SITE_KEY'"
  [action]="'submit'"
  [theme]="'auto'"
  [language]="'fr'"
  [cData]="'custom-data'"
  (resolved)="onResolved($event)">
</captcha-kit>
```

Backend verifies via Cloudflare's siteverify API.<grok:render card_id="dd6308" card_type="citation_card" type="render_inline_citation">
<argument name="citation_id">3</argument>
</grok:render>

### Alibaba Cloud Captcha 2.0

Supports sliding validation or intelligent modes. Integrate initialization code into client.<grok:render card_id="12fd6c" card_type="citation_card" type="render_inline_citation">
<argument name="citation_id">8</argument>
</grok:render><grok:render card_id="7e17ca" card_type="citation_card" type="render_inline_citation">
<argument name="citation_id">9</argument>
</grok:render>

Template:
```html
<captcha-kit
  type="alibaba"
  [sceneId]="'YOUR_SCENE_ID'"
  [mode]="'embed'"
  [language]="'en'"
  (resolved)="onResolved($event)">
</captcha-kit>
```

The `resolved` emits a param object; send to backend for verification using Alibaba's SDK.<grok:render card_id="3fdb99" card_type="citation_card" type="render_inline_citation">
<argument name="citation_id">8</argument>
</grok:render>

### Language Customization

All providers support language customization via the `language` input (e.g., 'en', 'zh', 'auto'). For reCAPTCHA, use `hl` parameter in script.<grok:render card_id="6b9330" card_type="citation_card" type="render_inline_citation">
<argument name="citation_id">2</argument>
</grok:render> Defaults to 'auto' (browser detection).

### Error Handling and Best Practices

- Handle `(error)` output for script failures, invalid keys, or timeouts.
- Always verify tokens server-side to prevent bypassing.
- SSR: Scripts won't load on server.
- Quotas: Monitor provider limits (e.g., Google 1M/month free).
- For v3/Turnstile: Generate tokens on actions to avoid expiration.

## API Reference

### CaptchaService

- `loadScript(url: string, onloadCallbackName?: string, language?: string): Promise<void>`: Loads scripts dynamically.
- `executeRecaptchaV3(siteKey: string, action: string, language?: string): Promise<string>`
- `executeTurnstile(siteKey: string, action?: string, cData?: string): Promise<string>`
- `executeAlibabaCaptcha(sceneId: string, options: {...})`

### CaptchaComponent

- **Inputs**:
  - `type: 'recaptcha-v2' | 'recaptcha-v3' | 'turnstile' | 'alibaba'`
  - `siteKey?: string` (for Google/Cloudflare)
  - `sceneId?: string` (for Alibaba)
  - `action?: string`
  - `theme?: 'light' | 'dark' | 'auto'`
  - `size?: 'normal' | 'compact' | 'invisible'`
  - `mode?: 'embed' | 'popup' | 'float'`
  - `cData?: string` (Turnstile)
  - `language?: string` (defaults to 'auto')
- **Outputs**:
  - `resolved: EventEmitter<string | any>`
  - `error: EventEmitter<any>`
- **Methods**:
  - `execute(): Promise<string>` (for v3 manual execution)

## Configuration Options

Customize via component inputs. For advanced needs, extend the service.

## Contributing

Fork the repo, create a branch, and submit a PR.

- Setup: `npm install`, `ng build ngx-captcha-kit`.
- Testing: Use the test-app project.
- Issues: Report on GitHub.

## License

MIT License. See [LICENSE](LICENSE) for details.
