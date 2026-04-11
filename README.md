# ditherer

![screenshot](screenshot.png)

Browser-based image and video processing for dithering, palette reduction, glitch art, print simulation, temporal effects, and filter-chain experimentation.

## What it does

- Build filter chains in the browser and reorder them with drag and drop
- Process still images or video clips with realtime preview
- Share looks through URL state or exported JSON
- Export processed output as images, GIFs, or video
- Explore a large built-in library of filters, palettes, and curated presets

## Highlights

- **200+ registered filter entries** spanning dithering, color, stylize, distort, glitch, blur, temporal, simulation, and analysis workflows
- **129 curated chain presets** for looks like VHS pause, cyberpunk, lo-fi webcam, CRT, print, anime, and glitch-art variants
- **Temporal pipeline** with previous-frame input/output buffers, EMA history, and frame index injection for motion- and persistence-based effects
- **Worker offload** for non-temporal chains so the UI stays responsive
- **Gamma-correct pipeline** with optional linear-light processing
- **Palette tooling** including built-in retro/art palettes plus adaptive and extracted palettes
- **WASM acceleration** for performance-critical color distance work with JS fallback
- **Rich export flows** for PNG, JPEG, WebP, GIF, frame sequences, WebM, and browser-dependent MP4 recording paths
- **Static gallery generation** from the live filter/preset registries

## Examples

https://github.com/gyng/ditherer/assets/370496/a721ceb8-d10b-4650-9db1-850a067d7af4

[vid](https://github.com/gyng/ditherer/assets/370496/ded429eb-d14c-437e-8bbd-ac65e1d05465)

[vid](https://github.com/gyng/ditherer/assets/370496/20e03295-d6f7-4517-bf36-d66f823cbc54)

[vid](https://github.com/gyng/ditherer/assets/370496/cba67de2-8821-4123-98b0-9a71c1fc9bd7)

## Gallery

- Browse the generated gallery in [docs/GALLERY.md](docs/GALLERY.md)
- Regenerate gallery previews with `npm run gallery`

## Development

```bash
npm install
npm run dev
npm run build
npm run preview
npm run lint
npm run typecheck
npm run test
```

Extra repo utilities:

- `npm run bench` to run performance benches
- `npm run bench:compare` to compare benchmark runs
- `npm run report:presets` to find duplicate or highly similar presets
- `npm run gallery` to regenerate `docs/GALLERY.md` and preview assets

## Build output and deployment

`npm run build` writes a static build to `build/`. The app uses `base: "./"` in Vite, so the output can be hosted from a subdirectory or copied to a static host without extra routing setup.

## Architecture and contributing

- [AGENTS.md](AGENTS.md) covers architecture, filter registration, the temporal pipeline, and contribution expectations
- [`src/filters/index.ts`](src/filters/index.ts) is the registry for filter metadata and worker-visible entries
- [`src/context/FilterContext.tsx`](src/context/FilterContext.tsx) owns chain execution, temporal state, sharing, and worker orchestration
- [docs/plan/](docs/plan/) contains numbered implementation plans

## References

1. http://www.efg2.com/Lab/Library/ImageProcessing/DHALF.TXT
2. http://www.tannerhelland.com/4660/dithering-eleven-algorithms-source-code/
3. http://www.easyrgb.com/en/math.php#text8
