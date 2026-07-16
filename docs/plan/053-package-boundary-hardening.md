# 053 — Package Boundary Hardening

## Goal

Make the Ditherer application prove that it can consume the exact packed
`@gyng/ditherer-filters` artifact that other projects install. Keep the fast
source-based development loop, but add a release gate that cannot accidentally
fall back to repository source aliases.

This milestone prepares `@gyng/ditherer-filters@0.1.1` and closes the remaining
monorepo-specific gaps found after the initial `0.1.0` GitHub Packages release.

## Workspace contract

- Declare `packages/ditherer-filters` as an npm workspace.
- Add `@gyng/ditherer-filters` as an explicit application dependency whose
  version matches the workspace package.
- Keep the package React-independent and independently packable.
- Ensure `npm ci` creates the workspace link deterministically from the lockfile.

The ordinary Vite development configuration may continue resolving the public
package entries to package source so a fresh checkout does not require a library
build before `npm run dev`. The packed-artifact gate must override those entries
with files installed from the generated tarball.

## Module-resolution cleanup

Production application code imports the engine only through
`@gyng/ditherer-filters` public entries. Legacy `filters`, `gl`, `palettes`,
`wasm`, `workers`, package `constants`, and root package `utils` aliases are
test-only implementation access and must not participate in the application
build resolver.

- Remove unused legacy engine paths from the application TypeScript config.
- Move implementation aliases still needed by focused engine tests into the
  Vitest-only alias configuration.
- Retain application-owned `utils/*` and other UI aliases.

## Packed application gate

Extend the packed-package fixture so one command:

1. builds and packs the library;
2. installs the tarball into the isolated consumer fixture;
3. builds the real Ditherer application with its four public package entries
   resolved from that installed artifact;
4. writes the build outside the normal application output directory; and
5. verifies the output contains the package's module-worker and WASM assets.

The special Vite config must fail early if the packed dependency has not been
prepared. It must not resolve any `@gyng/ditherer-filters` import from
`packages/ditherer-filters/src`.

## Release documentation

- Add a package changelog beginning with `0.1.0` and the boundary-hardening
  `0.1.1` release.
- Document the exact version bump, verification, tag, and GitHub Packages
  workflow procedure.
- Include the changelog in the published artifact.

## Release gates

- clean `npm ci` workspace/link contract, as represented by `package-lock.json`;
- `npm run lint` and `npm run typecheck`;
- targeted package-boundary and artifact-validation tests;
- `npm run test`;
- packed-library consumer test;
- packed Ditherer production build;
- ordinary application production build;
- `npm run test:gl` after the package rebuild;
- publish only from a green merge commit tagged `filters-v0.1.1`.

## Later work

Per-filter subpath exports and lazy catalog loading remain a `0.2.0` concern.
They change the public API and bundle topology and are intentionally separate
from this release-hardening patch.
