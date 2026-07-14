# 040 — Share bundled test media in URLs

## Objective

Make a shared Ditherer URL restore the bundled test image or test video that
was active when the URL was copied. Local uploads remain deliberately
unshareable because their file/blob URLs are private to the originating
browser session.

## Contract

- Store one validated query parameter named `testMedia` alongside the existing
  compressed filter-state hash.
- Encode only an allow-listed kind and bundled filename, for example
  `testMedia=image:pepper.png` or `testMedia=video:akiyo.mp4`.
- Preserve unrelated query parameters while the app is open, but include only
  the validated test-media parameter in an explicitly copied share URL.
- Remove the parameter when a local image or video is loaded so a share link
  never claims to restore media that is no longer active.
- Restore the requested bundled media before the default test-video autoload.
- Ignore malformed, unknown, and path-traversal values.

## Validation

1. Unit tests cover parsing, rejection, query preservation, replacement,
   removal, and share-query filtering.
2. A browser test loads a shared test image, changes to a test video, and
   reloads to prove both media types restore from the address bar.
3. Typecheck, lint, unit tests, production build, and focused Playwright pass.
