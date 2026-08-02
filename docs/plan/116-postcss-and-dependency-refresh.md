# 116 - PostCSS and dependency refresh

## Goal

Resolve the PostCSS path-traversal advisory and refresh the root dependency
set to the newest compatible releases available on 2026-08-03.

## Scope

- Upgrade direct dependencies within their existing major-version ranges.
- Align the root filter-library declaration with the linked
  `@gyng/ditherer-filters@0.6.0` workspace.
- Regenerate the workspace lockfile so Vite resolves patched
  `postcss@8.5.25` and the toolchain resolves patched
  `brace-expansion@5.0.9`.
- Use the ESM-native config directory API required by Vite's future native
  config loader.
- Add the standard JSON import attribute required by that loader in the
  package build config.
- Keep unrelated major migrations (`jsdom` 30, TypeScript 7, and Node 26
  types) out of this security-focused refresh.

## Verification

- `npm audit` reports zero vulnerabilities.
- `npm outdated` reports no compatible direct upgrades.
- TypeScript, ESLint, Vitest, production build, and lockfile consistency checks
  pass.
- `git diff --check` passes.

## Result

- Vite now resolves patched `postcss@8.5.25`, and the obsolete ESLint tree that
  supplied vulnerable `brace-expansion` has been removed by the follow-on Oxc
  migration.
- All compatible direct dependencies were refreshed and the internal
  `@gyng/ditherer-filters` declaration now matches its `0.6.0` workspace.
- The Vite 8.2 config-loader warnings were resolved in both application and
  package configs.
- The npm audit, 2,365 Vitest tests, TypeScript, lint, application build,
  package build, packed-consumer build, and bundle budgets pass.
