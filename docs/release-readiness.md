# Release Readiness

## Fork-safe repository links

- Prefer repository-relative links (for example, `[README](../README.md)`) for project files.
- For GitHub Pages references, prefer template form in docs: `https://<owner>.github.io/<repo>/`.

## Pre-release verification commands

- `npm ci --legacy-peer-deps`
- `npm test`
- `npm run build`
- `node scripts/harness/parse-write-idempotent.mjs src/__mocks__/save-game.json`
- `node scripts/harness/derive-stats.mjs src/__mocks__/save-game.json`

## Expected outcomes

- Tests pass with non-zero test count.
- Build completes successfully and emits `dist/`.
- Parser roundtrip reports `PARSER_ROUNDTRIP: ok` and `IDEMPOTENT: true`.
- Derived stats command exits successfully.
