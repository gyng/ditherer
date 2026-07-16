# Releasing `@gyng/ditherer-filters`

Releases are published to GitHub Packages from a merged, green `master`
commit. Do not publish from a developer machine.

## Prepare

1. Update `version` in `packages/ditherer-filters/package.json`.
2. Update the root application's exact `@gyng/ditherer-filters` dependency to
   the same version.
3. Add the release entry to `CHANGELOG.md`.
4. Run `npm install --package-lock-only --ignore-scripts --legacy-peer-deps`
   to update the workspace lock entry.

## Verify

Run the release gates from the repository root:

```sh
npm run check
npm run test:lib
npm run test:gl
```

`npm run build:packed-app` is included in `npm run check`. It builds the
library, packs and installs its tarball in the standalone example, enforces the
selective-import bundle ceiling, builds the real Ditherer application from
those installed public entries, and verifies the filter worker and RGB-to-Lab
WASM payload survived bundling.

Open a pull request and wait for both the main CI and WebGL shader gate to pass.

## Publish

After merging, tag the exact merge commit with the package version:

```sh
git fetch origin master
git tag -a filters-v0.2.0 origin/master -m "Release @gyng/ditherer-filters 0.2.0"
git push origin filters-v0.2.0
```

The `Publish filter package` workflow validates that the tag and manifest
versions match, repeats the package and packed-application gates, and publishes
with the repository `GITHUB_TOKEN`. Confirm the workflow log ends with the
expected `+ @gyng/ditherer-filters@<version>` line.

The same workflow may be run manually with an exact version input when a tag
event must be recovered. It will refuse a version that differs from the
manifest.

## npmjs distribution

GitHub Packages remains the authoritative automated registry. Publishing the
same version to npmjs requires a repository `NPM_TOKEN`, npm trusted publishing
or provenance configuration, and an explicit workflow step reviewed before
merge. Do not use ambient developer credentials or republish a version whose
GitHub Packages artifact differs.
