# ditherer

![screenshot](screenshot.png)

For all your online dithering needs. Browser-based image and video processing — load media, build a chain of filters, share a URL.

## Features

* **~160 filters** across dithering, color, stylize, distort, glitch, simulate, blur/edges, and advanced categories
* **Filter chains** — compose up to 16 filters, drag-to-reorder, save/load, share via URL or JSON
* **80+ chain presets** organized by category (Cyberpunk, VHS Pause, Stargate, Lo-fi Webcam, Glitch Art, …)
* **Dithering** — Floyd-Steinberg / Atkinson / Burkes / Sierra / Stucki / Jarvis with serpentine scanning, ordered (Bayer, hatch, blue noise 16×16 and 64×64 void-and-cluster), pixelsort, posterize, etc.
* **Temporal pipeline** — filters can read previous frames, EMA background models, and frame indices. Powers motion detect, long exposure, frame blend, phosphor decay, video feedback, slit scan, chronophotography, freeze-frame glitch, motion heatmap, and more
* **Temporal dithering** — `temporalPhases` on ordered dither and `temporalBleed` on error diffusion accumulate detail across frames (Playdate-style)
* **Video** — load any video file, realtime filter playback, video copy bakes the chain into a new webm via MediaRecorder
* **Image/video export** — SaveAs dialog with PNG, JPEG, GIF, and WebM output
* **80+ palettes** — CGA, Game Boy, PICO-8, NES, C64, Macintosh II, vaporwave, synthwave, Mondrian, Ukiyo-e, thermal, and more — plus adaptive/extracted palettes
* **Gamma-correct pipeline** — optional linear-light processing for accurate dithering and blurring
* **WASM acceleration** — Rust-compiled color space conversions for palette matching
* **Web worker offload** — non-temporal chains run off the main thread

## Examples

https://github.com/gyng/ditherer/assets/370496/a721ceb8-d10b-4650-9db1-850a067d7af4

[vid](https://github.com/gyng/ditherer/assets/370496/ded429eb-d14c-437e-8bbd-ac65e1d05465)

[vid](https://github.com/gyng/ditherer/assets/370496/20e03295-d6f7-4517-bf36-d66f823cbc54)

[vid](https://github.com/gyng/ditherer/assets/370496/cba67de2-8821-4123-98b0-9a71c1fc9bd7)

## Development

```
npm install
npm run dev          # dev server
npm run build        # production build to build/
npm run test         # vitest
npm run lint         # eslint + flow + stylelint
```

See [AGENTS.md](AGENTS.md) for architecture, the filter system, the temporal pipeline, and contribution guidelines.

## Deploying

```
npm run build
git checkout gh-pages
rm commons.js index.html app.*.js
mv build/* .
git add .
git commit
git push origin gh-pages
```

## References

1. http://www.efg2.com/Lab/Library/ImageProcessing/DHALF.TXT
2. http://www.tannerhelland.com/4660/dithering-eleven-algorithms-source-code/
3. http://www.easyrgb.com/en/math.php#text8
