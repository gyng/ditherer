# Filter Gallery

> All filters applied to `pepper.png` with default settings.

## Dithering

| | | |
|---|---|---|
| **Atkinson (Mac)**<br>Classic Mac dithering with 75% error diffusion for a crisp, high-contrast look<br>![Atkinson (Mac)](gallery/atkinson-mac.png) | **Atkinson (Macintosh II color test)**<br>Atkinson dithering with the original Macintosh II 16-color palette<br>![Atkinson (Macintosh II color test)](gallery/atkinson-macintosh-ii-color-test.png) | **Binarize**<br>Simple threshold to pure black and white with no error diffusion<br>![Binarize](gallery/binarize.png) |
| **Burkes**<br>Fast two-row error diffusion with smooth gradients<br>![Burkes](gallery/burkes.png) | **False Floyd-Steinberg**<br>Simplified Floyd-Steinberg using only two neighbors for a grainier result<br>![False Floyd-Steinberg](gallery/false-floyd-steinberg.png) | **Floyd-Steinberg**<br>The classic error-diffusion algorithm — balanced quality and speed<br>![Floyd-Steinberg](gallery/floyd-steinberg.png) |
| **Floyd-Steinberg (CGA test)**<br>Floyd-Steinberg with the 16-color CGA palette<br>![Floyd-Steinberg (CGA test)](gallery/floyd-steinberg-cga-test.png) | **Floyd-Steinberg (Vaporwave test)**<br>Floyd-Steinberg with a pastel vaporwave palette<br>![Floyd-Steinberg (Vaporwave test)](gallery/floyd-steinberg-vaporwave-test.png) | **Jarvis**<br>Three-row error diffusion for smoother gradients at the cost of speed<br>![Jarvis](gallery/jarvis.png) |
| **Ordered**<br>Bayer matrix threshold dithering — fast, tiled, no error diffusion<br>![Ordered](gallery/ordered.png) | **Ordered (Gameboy)**<br>Ordered dithering with the 4-shade Gameboy green palette<br>![Ordered (Gameboy)](gallery/ordered-gameboy.png) | **Ordered (Downwell Gameboy)**<br>Ordered dithering with Downwell's muted green Gameboy-style palette<br>![Ordered (Downwell Gameboy)](gallery/ordered-downwell-gameboy.png) |
| **Ordered (Windows 16-color)**<br>4x4 Bayer ordered dithering with the classic Windows 16-color palette<br>![Ordered (Windows 16-color)](gallery/ordered-windows-16-color.png) | **Quantize (No dithering)**<br>Reduce colors by snapping each pixel to the nearest palette color<br>![Quantize (No dithering)](gallery/quantize-no-dithering.png) | **Random**<br>Add random noise before quantizing for a stippled, noisy texture<br>![Random](gallery/random.png) |
| **Sierra (full)**<br>Three-row error diffusion similar to Jarvis but with different weights<br>![Sierra (full)](gallery/sierra-full.png) | **Sierra (lite)**<br>Minimal Sierra variant — fast with only two neighbors<br>![Sierra (lite)](gallery/sierra-lite.png) | **Sierra (two-row)**<br>Two-row Sierra for a balance between speed and quality<br>![Sierra (two-row)](gallery/sierra-two-row.png) |
| **Stucki**<br>Three-row error diffusion with sharper results than Jarvis<br>![Stucki](gallery/stucki.png) | **Triangle dither**<br>Triangle-distributed noise dithering for film-like grain<br>![Triangle dither](gallery/triangle-dither.png) |  |

## Color

| | | |
|---|---|---|
| **Brightness/Contrast**<br>Adjust image brightness and contrast levels<br>![Brightness/Contrast](gallery/brightness-contrast.png) | **Color balance**<br>Shift the balance between complementary color channels<br>![Color balance](gallery/color-balance.png) | **Color shift**<br>Rotate hue and shift saturation/lightness<br>![Color shift](gallery/color-shift.png) |
| **Duotone**<br>Map shadows and highlights to two custom colors<br>![Duotone](gallery/duotone.png) | **Grayscale**<br>Convert to grayscale using perceptual luminance weights<br>![Grayscale](gallery/grayscale.png) | **Histogram equalization**<br>Redistribute tonal range for better contrast across the image<br>![Histogram equalization](gallery/histogram-equalization.png) |
| **Histogram equalization (per-channel)**<br>Equalize each RGB channel independently — can introduce color shifts<br>![Histogram equalization (per-channel)](gallery/histogram-equalization-per-channel.png) | **Invert**<br>Flip all colors to their complement (negative)<br>![Invert](gallery/invert.png) | **Posterize**<br>Reduce color levels per channel for a flat, poster-like look<br>![Posterize](gallery/posterize.png) |
| **Solarize**<br>Partially invert tones above a threshold for a surreal darkroom effect<br>![Solarize](gallery/solarize.png) |  |  |

## Stylize

| | | |
|---|---|---|
| **ASCII**<br>Render the image as ASCII characters based on brightness<br>![ASCII](gallery/ascii.png) | **Halftone**<br>Simulate print halftone with variable-size dots<br>![Halftone](gallery/halftone.png) | **K-means**<br>Cluster pixels into k dominant colors using iterative refinement<br>![K-means](gallery/k-means.png) |
| **Kuwahara**<br>Edge-preserving smoothing for a painterly, watercolor-like look<br>![Kuwahara](gallery/kuwahara.png) | **Mavica FD7**<br>Emulate the Sony Mavica FD7 — low-res JPEG on a floppy disk<br>![Mavica FD7](gallery/mavica-fd7.png) | **Pixelate**<br>Downscale into chunky pixel blocks<br>![Pixelate](gallery/pixelate.png) |
| **Stripe (horizontal)**<br>Overlay horizontal stripe pattern over the image<br>![Stripe (horizontal)](gallery/stripe-horizontal.png) | **Stripe (vertical)**<br>Overlay vertical stripe pattern over the image<br>![Stripe (vertical)](gallery/stripe-vertical.png) | **Voronoi**<br>Divide the image into irregular cell regions with averaged colors<br>![Voronoi](gallery/voronoi.png) |

## Distort

| | | |
|---|---|---|
| **Chromatic aberration**<br>Offset color channels to simulate lens fringing<br>![Chromatic aberration](gallery/chromatic-aberration.png) | **Chromatic aberration (per-channel)**<br>Move each RGB channel independently for extreme color splitting<br>![Chromatic aberration (per-channel)](gallery/chromatic-aberration-per-channel.png) | **Displace**<br>Warp pixels using the image's own luminance as a displacement map<br>![Displace](gallery/displace.png) |
| **Displace (smooth)**<br>Displacement mapping with a blurred source for gentler warping<br>![Displace (smooth)](gallery/displace-smooth.png) | **Lens distortion**<br>Apply barrel distortion like a wide-angle lens<br>![Lens distortion](gallery/lens-distortion.png) | **Lens distortion (pincushion)**<br>Apply inward pincushion distortion like a telephoto lens<br>![Lens distortion (pincushion)](gallery/lens-distortion-pincushion.png) |
| **Wave**<br>Displace pixels along sine waves for a ripple effect<br>![Wave](gallery/wave.png) |  |  |

## Glitch

| | | |
|---|---|---|
| **Bit crush**<br>Reduce bit depth per channel for harsh color banding<br>![Bit crush](gallery/bit-crush.png) | **Channel separation**<br>Split and offset RGB channels for a glitchy color-fringe look<br>![Channel separation](gallery/channel-separation.png) | **Jitter**<br>Randomly shift pixel rows for a shaky, unstable signal look<br>![Jitter](gallery/jitter.png) |
| **Pixelsort**<br>Sort pixel spans by brightness for dramatic streak effects<br>![Pixelsort](gallery/pixelsort.png) |  |  |

## Simulate

| | | |
|---|---|---|
| **Anisotropic diffusion**<br>Smooth flat regions while preserving edges — like Perona-Malik filtering<br>![Anisotropic diffusion](gallery/anisotropic-diffusion.png) | **CRT emulation**<br>Simulate a CRT monitor with phosphor mask, bloom, scanlines, curvature, and vignette<br>![CRT emulation](gallery/crt-emulation.png) | **Scanline**<br>Add horizontal scanline gaps like a retro CRT display<br>![Scanline](gallery/scanline.png) |
| **VHS emulation**<br>Simulate VHS tape artifacts — color bleed, noise, and tracking errors<br>![VHS emulation](gallery/vhs-emulation.png) |  |  |

## Blur & Edges

| | | |
|---|---|---|
| **Bloom**<br>Add a soft glow around bright areas<br>![Bloom](gallery/bloom.png) | **Convolve**<br>Apply a custom convolution kernel — blur, sharpen, emboss, and more<br>![Convolve](gallery/convolve.png) | **Convolve (edge detection)**<br>Detect edges using a Laplacian convolution kernel<br>![Convolve (edge detection)](gallery/convolve-edge-detection.png) |
