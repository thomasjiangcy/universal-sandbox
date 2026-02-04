# @usbx/daytona

## 0.2.0

### Minor Changes

- 1a85cd1: Add a provider image builder API and allow creating sandboxes from built or registry image references.
  Rename `SandboxManager` to `SandboxClient`.
  This change should be released as a prerelease.
- 468c7a3: Add mount support to CreateOptions, including native volume and bucket mounts where supported and emulated mounts for E2B and Sprites.

### Patch Changes

- Updated dependencies [1a85cd1]
- Updated dependencies [468c7a3]
  - @usbx/core@0.2.0

## 0.2.0-alpha.1

### Minor Changes

- 468c7a3: Add mount support to CreateOptions, including native volume and bucket mounts where supported and emulated mounts for E2B and Sprites.

### Patch Changes

- Updated dependencies [468c7a3]
  - @usbx/core@0.2.0-alpha.1

## 0.2.0-alpha.0

### Minor Changes

- 1a85cd1: Add a provider image builder API and allow creating sandboxes from built or registry image references.
  Rename `SandboxManager` to `SandboxClient`.
  This change should be released as a prerelease.

### Patch Changes

- Updated dependencies [1a85cd1]
  - @usbx/core@0.2.0-alpha.0

## 0.1.0

### Minor Changes

- 259fc35: Add Daytona provider.
- 9078671: add execStream support across core types and providers
- 5583843: Remove the `getServiceUrl` and `getTcpProxy` methods from the public sandbox API.
- 76bacac: Add TCP proxy support to the core API and providers, plus e2e coverage.

### Patch Changes

- 43a1eef: Add provider-level sandbox deletion support via the unified delete API.
- cbd4229: Add unified service URL support across core types and providers, with provider-specific behavior and e2e coverage.
- Updated dependencies [9078671]
- Updated dependencies [259fc35]
- Updated dependencies [43a1eef]
- Updated dependencies [5583843]
- Updated dependencies [ad67438]
- Updated dependencies [cbd4229]
- Updated dependencies [76bacac]
  - @usbx/core@0.1.0

## 0.1.0-alpha.6

### Minor Changes

- 5583843: Remove the `getServiceUrl` and `getTcpProxy` methods from the public sandbox API.

### Patch Changes

- Updated dependencies [5583843]
  - @usbx/core@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- Updated dependencies [ad67438]
  - @usbx/core@0.1.0-alpha.5

## 0.1.0-alpha.4

### Minor Changes

- 76bacac: Add TCP proxy support to the core API and providers, plus e2e coverage.

### Patch Changes

- Updated dependencies [76bacac]
  - @usbx/core@0.1.0-alpha.4

## 0.1.0-alpha.3

### Patch Changes

- cbd4229: Add unified service URL support across core types and providers, with provider-specific behavior and e2e coverage.
- Updated dependencies [cbd4229]
  - @usbx/core@0.1.0-alpha.3

## 0.1.0-alpha.2

### Minor Changes

- 9078671: add execStream support across core types and providers

### Patch Changes

- Updated dependencies [9078671]
  - @usbx/core@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- 43a1eef: Add provider-level sandbox deletion support via the unified delete API.
- Updated dependencies [43a1eef]
  - @usbx/core@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- Add Daytona provider.

### Patch Changes

- Updated dependencies
  - @usbx/core@0.1.0-alpha.0
