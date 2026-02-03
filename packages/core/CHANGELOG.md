# @usbx/core

## 0.2.0-alpha.1

### Minor Changes

- 468c7a3: Add mount support to CreateOptions, including native volume and bucket mounts where supported and emulated mounts for E2B and Sprites.

## 0.2.0-alpha.0

### Minor Changes

- 1a85cd1: Add a provider image builder API and allow creating sandboxes from built or registry image references.
  Rename `SandboxManager` to `SandboxClient`.
  This change should be released as a prerelease.

## 0.1.0

### Minor Changes

- ad67438: rename UniversalSandbox to SandboxClient
- 9078671: add execStream support across core types and providers
- 259fc35: Initial alpha release.
- 5583843: Remove the `getServiceUrl` and `getTcpProxy` methods from the public sandbox API.
- 76bacac: Add TCP proxy support to the core API and providers, plus e2e coverage.

### Patch Changes

- 43a1eef: Add provider-level sandbox deletion support via the unified delete API.
- cbd4229: Add unified service URL support across core types and providers, with provider-specific behavior and e2e coverage.

## 0.1.0-alpha.6

### Minor Changes

- 5583843: Remove the `getServiceUrl` and `getTcpProxy` methods from the public sandbox API.

## 0.1.0-alpha.5

### Major Changes

- ad67438: rename UniversalSandbox to SandboxClient

## 0.1.0-alpha.4

### Minor Changes

- 76bacac: Add TCP proxy support to the core API and providers, plus e2e coverage.

## 0.1.0-alpha.3

### Patch Changes

- cbd4229: Add unified service URL support across core types and providers, with provider-specific behavior and e2e coverage.

## 0.1.0-alpha.2

### Minor Changes

- 9078671: add execStream support across core types and providers

## 0.1.0-alpha.1

### Patch Changes

- 43a1eef: Add provider-level sandbox deletion support via the unified delete API.

## 0.1.0-alpha.0

### Minor Changes

- Initial alpha release.
