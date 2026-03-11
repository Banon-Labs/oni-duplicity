# Duplicity (V3)

A web-based Oxygen Not Included save editor.

Source repository: [this repository](.).

If this fork is deployed with GitHub Pages, the editor URL is usually:
`https://<owner>.github.io/<repo>/`

The saved files are located in:

macOS: `~/Library/Application Support/unity.Klei.Oxygen Not Included/save_files/`

Windows: `%USERPROFILE%\Documents\Klei\OxygenNotIncluded\save_files\`

# Compatibility

Supports base-game save versions up to 7.37. DLC saves are not supported in this release.

# V3

This branch is a rewrite of the UI focusing on ease of use and community requested features.

# Development Install

Use `npm ci --legacy-peer-deps` for reproducible installs in this fork.

`npm ci` currently fails due to a React 18 peer-dependency conflict through `connected-react-router`, so CI and local setup intentionally use the legacy peer resolution path until dependency graph remediation lands.

# Translations

This project is ready for translations.

To contribute a translation, translate [/src/translations/en/common.json](src/translations/en/common.json) and [/src/translations/en/oni.json](src/translations/en/oni.json) and submit them in a new issue.

# Implementation

The actual save serialization is done by the [oni-save-parser](https://github.com/RoboPhred/oni-save-parser) library. Feel free to use this library in your own projects.

# Release Readiness

Before cutting a release, run:

- `npm test`
- `npm run build`
- `node scripts/harness/parse-write-idempotent.mjs src/__mocks__/save-game.json`
- `node scripts/harness/derive-stats.mjs src/__mocks__/save-game.json`
