# Plan 006 — Filter List Organization

**Goal:** Organize the 61-filter flat dropdown into categorized groups so users can find filters by intent rather than scrolling an undifferentiated list.

---

## Problem

The algorithm `<select>` is a flat list of 61 entries in arbitrary order. Presets (CGA test, Vaporwave, Gameboy) are interleaved with base algorithms. No visual structure guides the user.

| Principle | Violation |
|---|---|
| **Hick's Law** | 61 undifferentiated choices = decision paralysis |
| **Chunking (Miller's Law)** | No visual grouping — impossible to scan by category |
| **Recognition > Recall** | Users must remember filter names; can't browse by intent |
| **Information Architecture** | No structure mapping "what do I want?" to filter selection |

---

## Solution

Use native HTML `<optgroup>` to organize filters into semantic categories. Zero new components, accessible by default, works with the existing `<select>`.

### Category assignments (8 groups, 61 filters)

Each filter's `displayName` maps to exactly one category:

| Category | Count | Filters |
|---|---|---|
| **Dithering** | 19 | Atkinson (Mac), Atkinson (Macintosh II color test), Binarize, Burkes, False Floyd-Steinberg, Floyd-Steinberg, Floyd-Steinberg (CGA test), Floyd-Steinberg (Vaporwave test), Jarvis, Ordered, Ordered (Gameboy), Ordered (Windows 16-color), Quantize (No dithering), Random, Sierra (full), Sierra (lite), Sierra (two-row), Stucki, Triangle dither |
| **Color** | 10 | Brightness/Contrast, Color balance, Color shift, Duotone, Grayscale, Histogram equalization, Histogram equalization (per-channel), Invert, Posterize, Solarize |
| **Stylize** | 9 | ASCII, Halftone, K-means, Kuwahara, Mavica FD7, Pixelate, Stripe (horizontal), Stripe (vertical), Voronoi |
| **Distort** | 7 | Chromatic aberration, Chromatic aberration (per-channel), Displace, Displace (smooth), Lens distortion, Lens distortion (pincushion), Wave |
| **Glitch** | 5 | Bit crush, Channel separation, Glitch, Jitter, Pixelsort |
| **Simulate** | 7 | Anisotropic diffusion, CRT emulation, Reaction-diffusion (coral), Reaction-diffusion (labyrinth), Reaction-diffusion (worms), Scanline, VHS emulation |
| **Blur & Edges** | 3 | Bloom, Convolve, Convolve (edge detection) |
| **Advanced** | 1 | Program |

**Total: 19 + 10 + 9 + 7 + 5 + 7 + 3 + 1 = 61**

### Design rationale

- **Dithering first** — the app's primary purpose; users land here most often
- **8 categories** — within Miller's 7±2 for scannable top-level chunks
- **Named by user intent** — "what effect do I want?" not "what algorithm is this?"
- **Presets kept inline** — CGA/Gameboy/Vaporwave are discoverable starting points within their base algorithm's category
- **Program isolated in Advanced** — uses `eval`, power-user only
- **Alphabetized within each category** — predictable scan order

---

## Implementation

### Step 1 — Add `category` to filterList, export category order

**File:** `src/filters/index.ts`

Add a `category` string to every entry in `filterList`. Reorder entries to be grouped by category, alphabetized within each group. Export the category order:

```ts
export const filterCategories = [
  "Dithering", "Color", "Stylize", "Distort",
  "Glitch", "Simulate", "Blur & Edges", "Advanced"
];
```

Each entry becomes:
```ts
{ displayName: "Floyd-Steinberg", filter: floydSteinberg, category: "Dithering" },
```

### Step 2 — Render `<optgroup>` in App

**File:** `src/components/App/index.tsx`

Import `filterCategories` from `filters`. Replace the flat `filterList.map()` with grouped rendering:

```tsx
{filterCategories.map(cat => (
  <optgroup key={cat} label={cat}>
    {filterList
      .filter(f => f.category === cat)
      .map(f => (
        <option key={f.displayName} value={f.displayName}>
          {f.displayName}
        </option>
      ))}
  </optgroup>
))}
```

### Step 3 — Style optgroup labels

**File:** `src/components/controls/styles.module.css`

Override browser default italic on optgroup labels:

```css
.enum optgroup {
  font-weight: bold;
  font-style: normal;
}
```

---

## Files to modify

| File | Change |
|---|---|
| `src/filters/index.ts` | Add `category` to each filterList entry, reorder by group, export `filterCategories` |
| `src/components/App/index.tsx` | Import `filterCategories`, render `<optgroup>` groups |
| `src/components/controls/styles.module.css` | Style optgroup labels |

No new files, components, or dependencies.

---

## Verification

1. `npm run dev` — dropdown shows 8 labeled groups with filters inside each
2. Select a filter from each group — confirm it loads and applies correctly
3. Currently selected filter remains selected after the change
4. Count options in dropdown = 61 (no filters lost or duplicated)
5. Mobile viewport — native `<select>` optgroup rendering works
6. `npm run build` — no errors
7. `npm run test` — all pass (tests use `filterIndex`, not the dropdown)
