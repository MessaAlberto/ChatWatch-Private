# Changelog

All notable changes to ChatWatch Private are documented here.

## [1.2.0] - 2026-11-07

### Added
- Optional locally synthesized two-note completion sound (enabled by default).
- Independent audio preview button and persistent sound preference in the popup.
- Manifest V3 `offscreen` audio document, opened on demand without remote services.
- Audio and notification regression tests.

### Changed
- New `offscreen` permission for sound playback, without expanding site access.
- Documentation covering audio controls and troubleshooting.

## [1.1.1] - 2026-11-07

### Added
- OS-aware notification guidance for macOS, Windows, Linux, and ChromeOS.
- A persistent settings hint in the popup using Chrome's `runtime.getPlatformInfo()` API.
- Public repository documentation, source license, contribution and security guidelines, automated tests, and a sample UI screenshot.

### Changed
- Notification test messages now use the appropriate operating-system settings path instead of Windows-only text.
- Updated wording for unsupported and denied notifications.

### Unchanged
- Selected-chat monitoring and response detection behavior.
- Storage and host permissions; no additional extension permissions are required.

## [1.1.0] - 2026-11-07

- Improved completion detection for different Stop-button variants.
- Added response-detection diagnostics and related tests.

## [1.0.2] - 2026-11-07

- Fixed a missing popup element for notification diagnostics.
- Added popup element consistency tests.
