# CSS pipeline cleanup

Find why Lightning CSS crashed and remove the remaining PostCSS build warning.
Restore Vite's default CSS minifier if the crash is environmental, and keep the
rendered styles identical.

## Result

The Lightning CSS crash was a corrupted local install, not a toolchain bug. The
installed `lightningcss.linux-x64-gnu.node` matched the lockfile version but had
876,988 bytes zeroed in whole 4 KiB pages from offset 4 MiB. npm had kept the
damaged directory across upgrades. A clean `npm ci` restores it, and every
`transform` call succeeds. The esbuild CSS minifier override is removed.

Lightning CSS then rejected 98.css's `@media (not(hover))`. `not(` is a
function token, so browsers have never matched that block. A pre-transform
plugin drops the block and wraps 98.css in the `win98` layer. 98.css is now
imported from the entry because Vite reads CSS `@import`s directly from disk.

The PostCSS `from` warning came from postcss-modules re-parsing every
`composes ... from` target without a source file. Vite now uses Lightning CSS
to compile CSS modules, so builds have no warnings. Lightning CSS also inlines
those composed targets into each importing module, and minification does not
deduplicate them. Index CSS is 151.25 kB (25.73 kB gzip), compared with
143.12 kB (27.01 kB gzip) under the esbuild deduplication. Replacing the 20
cross-file `composes` with class composition in components would remove that
duplication.

`npm run check` passes with 2,420 Vitest tests. Twenty-seven UX, accessibility,
layout, workflow, audio and library Chromium tests pass. Computed styles of all
835-875 elements match the previous build on desktop, phone and the command
palette, except one live frame-timing label.
