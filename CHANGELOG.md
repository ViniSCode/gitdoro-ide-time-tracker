# Change Log

All notable changes to the "gitdoro-vscode" extension will be documented in this file.

## [0.1.2] - 2026-03-06

### Added
- Added `gitdoro.autoTrackDelay` to configure a delay before automatically tracking time when the IDE is focused
- Added `gitdoro.pauseOnBlur` and `gitdoro.pauseOnBlurDelay` settings to customize pausing behavior when the IDE loses focus
- Added auto-tracking tutorial with settings screenshot to the README

## [0.1.1] - 2026-03-06

### Fixed
- Fixed correct repository detection to uses `viniscode`
- Fixed case-sensitive issuer in redirect URI scheme allowing auto sign-in to IDE
- Issue with auto-tracking not initializing correctly on IDE startup if window is already focused

### Added
- Auto-tracking feature tutorial added to README

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
