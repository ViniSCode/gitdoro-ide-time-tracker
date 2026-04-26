# Change Log

All notable changes to the "gitdoro-vscode" extension will be documented in this file.

## [0.1.5] - 2026-04-26

### Fixed
- Prevent inflated session durations caused by system suspend/sleep/hibernate
- `accumulateTime()` now caps time gaps at 10 minutes per interval
- Added absolute session cap of 12 hours to prevent extreme outliers

### Changed
- Timer now detects and handles system idle/sleep gracefully

## [0.0.3] - 2026-03-01

### Fixed
- Auth redirect now opens the correct IDE (Cursor, Antigravity, etc.) instead of always opening VS Code
- Fixed publisher name in deep link URI from `viniscodes` to `Gitdoro`

### Changed
- Auth flow now uses `vscode.env.uriScheme` for IDE-agnostic redirects
- Updated web auth page text to be editor-agnostic

## [0.0.2] - 2026-03-01

### Changed
- Updated publisher to Gitdoro
- Added marketplace metadata (icon, bugs, homepage, keywords)
- Improved README with tutorial and feature documentation


### Added
- Initial release of the Gitdoro Time Tracker extension
- Secure OAuth device flow authentication with Gitdoro web
- Status bar timer for tracking deep work
- Auto-sync integration for Git repositories
- Start, Pause, and Stop commands
- Background periodic sync
