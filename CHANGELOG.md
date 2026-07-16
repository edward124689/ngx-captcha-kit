# Changelog

All notable changes to this project will be documented in this file.

## [22.2.0] - 2026-07-16

### Added

- Reinitialize active CAPTCHA widgets when relevant component inputs change.
- Add lifecycle-safe manual execution for invisible reCAPTCHA v2, reCAPTCHA v3, and Cloudflare Turnstile.
- Add Turnstile `execution` and `appearance` inputs plus `expired` and `timedOut` outputs.
- Export provider API types, Alibaba region and instance types, and reusable component input types.
- Add a package dry-run to the full CI pipeline so publishable artifacts are checked on every supported Node version.

### Changed

- Upgrade Angular framework and compiler packages to 22.0.7.
- Reuse page-level provider SDKs more safely and document their shared configuration constraints.
- Preserve the public constructor signatures from 22.1.0 while keeping stricter internal DOM typing.

### Fixed

- Prevent stale asynchronous provider loads and callbacks from rendering or settling executions after a widget is replaced or destroyed.
- Reject pending manual executions when a component is reinitialized or destroyed.
- Settle manual execution promises before emitting public outputs so subscriber-driven reinitialization cannot invalidate completed tokens.
- Clean up replaced Alibaba CAPTCHA instances and temporary reCAPTCHA v3 or Turnstile widgets.
- Reject incompatible Google reCAPTCHA and Alibaba SDK configurations instead of silently reusing an invalid page-level setup.
- Handle Turnstile error, expiry, and timeout callbacks consistently.

[22.2.0]: https://github.com/edward124689/ngx-captcha-kit/compare/v22.1.0...v22.2.0
