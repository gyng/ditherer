# 117 - Oxc toolchain and TypeScript 7

## Goal

Replace the JavaScript-based linting and formatting stack with the Oxc tools,
and adopt the native TypeScript 7 compiler.

## Decisions

- Keep PostCSS as a patched transitive Vite dependency. The application has no
  PostCSS config or direct dependency to remove, while Vite requires PostCSS
  for its CSS pipeline.
- Replace ESLint and typescript-eslint with Oxlint plus `oxlint-tsgolint`.
  Enable type-aware rules through tsgolint and keep compiler diagnostics in the
  dedicated TypeScript 7 gate.
- Replace Prettier with Oxfmt, adopt Oxfmt's defaults, preserve the existing
  WASM-source ignore, leave generator-owned registry files to their canonical
  generator, and gate all handwritten repository files in `npm run check`.
- Upgrade to TypeScript 7 and convert `paths` entries from `baseUrl`-relative
  paths to project-relative paths.

## Verification

- Oxlint with `oxlint-tsgolint` type-aware rules passes; TypeScript compiler
  diagnostics remain the responsibility of the dedicated TypeScript 7 gate.
- TypeScript 7 passes the root and declaration-build projects.
- Oxfmt check passes after the one-time repository-wide normalization.
- Vitest, production build, and packed-library build pass.
- `npm audit` reports zero vulnerabilities.
- `git diff --check` passes.

## Result

- ESLint, typescript-eslint, globals, and Prettier were removed. Oxlint
  `1.76.0`, `oxlint-tsgolint` `7.0.2001`, and Oxfmt `0.61.0` replace them.
- Oxfmt defaults were applied once across the repository. `format:check` is now
  part of `npm run check`; user-owned `.vscode` settings and generator-owned
  registry files remain outside formatter ownership.
- TypeScript `7.0.2` passes the application and declaration projects after
  converting all `baseUrl`-relative aliases to project-relative `paths`.
- Generator consistency, Oxfmt, Oxlint, TypeScript, 2,365 Vitest tests,
  application build, packed-library consumer build, npm audit, and diff checks
  pass.
