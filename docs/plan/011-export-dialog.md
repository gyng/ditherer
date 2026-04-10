# Plan 011 — Save As Dialog

**Goal:** Unified export dialog replacing the separate Capture window, sidebar capture button, and title bar record button. One floppy disk button on the Output title bar opens a "Save As" dialog that handles image export (PNG/JPEG/WebP), clipboard copy, resolution scaling, and video export (WebM recording, GIF, PNG sequence).

---

## Wireframes

### Image Tab

```
┌─────────────────────────────────────────────┐
│ ▒▒ Save As                             [X]  │
├─────────────────────────────────────────────┤
│ ┌───────┐┌───────┐                          │
│ │ Image ││ Video │                          │
│ ┘       └┤       ├──────────────────────────┤
│                                             │
│  Format      [PNG        v]                 │
│                                             │
│  Quality     [████████░░░░] 0.92            │  ← hidden for PNG
│                                             │
│  Resolution  (●) 1x  ( ) 2x  ( ) 4x       │
│              ( ) Custom [__]                │
│                                             │
│  640 x 480  →  1280 x 960                  │
│                                             │
│  ┌────────┐  ┌──────────────────┐           │
│  │  Save  │  │ Copy to Clipboard│           │
│  └────────┘  └──────────────────┘           │
│                                             │
└─────────────────────────────────────────────┘
```

- Video tab only shown when `state.video` or `state.realtimeFiltering` is active
- "Copy to Clipboard" shows "Copied!" for 2s on success
- Dimension line updates live as resolution changes

### Video Tab — WebM

```
┌─────────────────────────────────────────────┐
│ ▒▒ Save As                             [X]  │
├─────────────────────────────────────────────┤
│ ┌───────┐┌───────┐                          │
│ │ Image ││ Video │                          │
│ ┤       ├┘       └──────────────────────────┤
│                                             │
│  Format      [WebM       v]                 │
│                                             │
│  Codec       [VP9        v]                 │
│                                             │
│  Bitrate     [████░░░░░░░░] 2.5 Mbps       │
│                                             │
│  ┌──────────────┐  ┌──────────┐             │
│  │ ● Record     │  │  Save    │             │
│  └──────────────┘  └──────────┘             │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │         [video preview]             │    │  ← appears after stop
│  └─────────────────────────────────────┘    │
│                                             │
│  ● REC 00:05                                │  ← while recording
│                                             │
└─────────────────────────────────────────────┘
```

- Record toggles start/stop; button text changes to "■ Stop"
- Save button disabled until a recording exists
- Video preview element shows last recording inline (with native controls)
- Timer counts up while recording

### Video Tab — GIF / Sequence

```
│  Format      [GIF        v]                 │
│                                             │
│  Frames      [████░░░░░░░░]  30             │
│                                             │
│  FPS         [███░░░░░░░░░]  10             │  ← GIF only
│                                             │
│  ┌──────────┐                               │
│  │  Export   │                              │
│  └──────────┘                               │
│                                             │
│  Capturing frame 5/30...                    │  ← progress text
```

- Frames slider: 1–120
- FPS slider: 1–30 (GIF only — sets inter-frame delay)
- Sequence format downloads numbered PNGs: `ditherer-seq-0001.png`

---

## What Gets Removed from App

The following move into the SaveAs component or are deleted:

| Current location | What | Action |
|---|---|---|
| App state | `capturing`, `hasCapture` | Move into SaveAs |
| App refs | `mediaRecorderRef`, `chunksRef`, `streamRef`, `captureVideoRef` | Move into SaveAs |
| App refs | `captureDragRef` | Delete |
| App hook | `captureDrag = useDraggable(captureDragRef)` | Delete |
| App callback | `handleCapture` | Move into SaveAs |
| App callback | `handleSaveImage` | Move into SaveAs |
| App callback | `handleDownloadCapture` | Delete |
| App effect | "Create capture video element once" (lines 80–85) | Move into SaveAs |
| App JSX | Capture window (lines 568–593) | Delete |
| App JSX | Record button on Output title bar | Replace with single floppy button |
| App JSX | Sidebar "Capture output video" button (lines 403–412) | Delete |
| App CSS | `.captureSection` | Delete |
| App CSS | `.rec` (REC blink indicator) | Move to SaveAs styles |

### Output Title Bar — Before & After

**Before** (two buttons):
```tsx
<span className={s.titleBarButtons}>
  <button title="Save image (PNG)" onClick={handleSaveImage}>&#128190;</button>
  <button title="Record video" onClick={handleCapture}>&#9679;</button>
</span>
```

**After** (one button):
```tsx
<span className={s.titleBarButtons}>
  <button title="Save As..." onClick={() => setShowSaveAs(true)}>&#128190;</button>
</span>
```

---

## New Files

### `src/components/SaveAs/index.tsx`

```tsx
interface SaveAsProps {
  outputCanvasRef: React.RefObject<HTMLCanvasElement>;
  onClose: () => void;
}
```

**State:**
```
activeTab:        "image" | "video"
format:           "png" | "jpeg" | "webp"
quality:          number (0.01–1, default 0.92)
resolution:       "1" | "2" | "4" | "custom"
customMultiplier: number (default 2)
videoFormat:      "webm" | "gif" | "sequence"
codec:            "vp8" | "vp9"     — filtered by isTypeSupported()
bitrate:          number (0.5–10 Mbps, default 2.5)
frames:           number (1–120, default 30)
gifFps:           number (1–30, default 10)
capturing:        boolean
recordingTime:    number (seconds, for timer display)
recordedBlob:     Blob | null
exporting:        boolean
progress:         string | null
copySuccess:      boolean
```

**Refs:**
```
mediaRecorderRef: MediaRecorder | null
chunksRef:        BlobPart[]
streamRef:        MediaStream | null
videoPreviewRef:  HTMLVideoElement | null
timerRef:         number | null (interval ID)
```

**Key functions:**

`getScaledCanvas()` — nearest-neighbor upscale of output canvas:
```tsx
const mult = resolution === "custom" ? customMultiplier : parseInt(resolution);
if (mult === 1) return source;
const scaled = document.createElement("canvas");
scaled.width = source.width * mult;
scaled.height = source.height * mult;
const ctx = scaled.getContext("2d")!;
ctx.imageSmoothingEnabled = false;
ctx.drawImage(source, 0, 0, scaled.width, scaled.height);
return scaled;
```

`handleSave()` — image download:
```tsx
const mimeType = `image/${format}`;
canvas.toBlob(blob => { /* createObjectURL → <a>.click() → revokeObjectURL */ },
  mimeType, format === "png" ? undefined : quality);
```

`handleCopy()` — clipboard:
```tsx
canvas.toBlob(blob => {
  navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}, "image/png");
```

`handleRecord()` — WebM start/stop toggle:
```tsx
// Start: captureStream(25) → new MediaRecorder(stream, { mimeType, videoBitsPerSecond })
//        Also mixes audio track from state.video if volume > 0 (existing pattern)
//        Start interval timer for recording duration display
// Stop:  stop tracks → blob → setRecordedBlob → show in videoPreviewRef
```

`handleExportGif()` — frame capture + encode:
```tsx
// rAF loop capturing `frames` frames → getScaledCanvas() → getImageData()
// dynamic import("modern-gif").encode() → download blob
```

`handleExportSequence()` — numbered PNGs:
```tsx
// rAF loop capturing `frames` frames → getScaledCanvas() → toBlob("image/png")
// Download each as ditherer-seq-NNNN.png
```

**Codec detection on mount:**
```tsx
useEffect(() => {
  const supported = ["vp9", "vp8"].filter(c =>
    MediaRecorder.isTypeSupported(`video/webm; codecs=${c}`)
  );
  // Set codec to first supported, expose list to Enum
}, []);
```

**Keyboard/mouse:**
- Escape → `onClose()`
- Click overlay → `onClose()` (unless recording/exporting)
- `e.stopPropagation()` on dialog to prevent overlay close

**Edge cases:**
- Save/Copy disabled when `canvas.width === 0` (no image loaded)
- Video tab disabled when `!state.video && !state.realtimeFiltering`
- GIF/Sequence disabled when `!state.realtimeFiltering && !state.video` (identical frames)
- Copy button hidden when `!navigator.clipboard?.write`
- Warning text when export dimensions > 4096px
- Prevent close while recording (show confirm or auto-stop)

### `src/components/SaveAs/styles.module.css`

Based on `ModalInput/styles.module.css` and `ChainList` confirm dialog patterns:

```
.overlay         — position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:10000
.dialog          — min-width:320px; max-width:90vw; var(--light-gray) bg; Win98 outset borders
.titleBar        — blue gradient; display:flex; color:white; font-weight:bold
.closeBtn        — Win98 raised button (matches .confirmTitleClose pattern)
.body            — padding:12px
.tabs            — display:flex; border-bottom:2px solid var(--button-shadow)
.tab             — padding:4px 12px; Win98 raised borders; cursor:pointer
.tabActive       — border-bottom:none; margin-bottom:-2px; bg matches .body
.tabContent      — padding:12px 0
.row             — display:flex; align-items:center; gap:8px; margin-bottom:8px
.rowLabel        — min-width:80px; font-size:12px
.radioGroup      — display:flex; flex-wrap:wrap; gap:8px
.dims            — font-size:11px; color:#555; font-family:monospace
.buttons         — display:flex; gap:6px; margin-top:12px (matches ModalInput .buttons)
.btn             — Win98 raised button style (matches ModalInput .buttons button)
.btn:active      — Win98 pressed inset borders
.btn:disabled    — opacity:0.5; cursor:default
.videoPreview    — max-width:100%; border:2px inset #ccc
.rec             — color:red; font-weight:bold; animation:blink (moved from App styles)
.progress        — font-size:11px; color:#555; margin-top:4px
.warning         — font-size:11px; color:#c00
.copyFlash       — color:green; font-size:11px

@media (max-width: 768px)
  .dialog        — width:calc(100vw - 32px)
  .btn           — min-height:44px; font-size:14px
  .tab           — min-height:44px; padding:8px 16px
```

---

## Modified Files

### `src/components/App/index.tsx`

**Remove:**
- State: `capturing`, `hasCapture`
- Refs: `mediaRecorderRef`, `chunksRef`, `streamRef`, `captureVideoRef`, `captureDragRef`
- Hooks: `captureDrag = useDraggable(captureDragRef)`
- Effect: "Create capture video element once"
- Callbacks: `handleCapture`, `handleSaveImage`, `handleDownloadCapture`
- JSX: Capture window div, record button on Output title bar, sidebar capture button + `.captureSection`

**Add:**
- State: `showSaveAs` (boolean)
- Import: `SaveAs` from `components/SaveAs`
- JSX: Single floppy button on Output title bar → `onClick={() => setShowSaveAs(true)}`
- JSX: `{showSaveAs && <SaveAs outputCanvasRef={outputCanvasRef} onClose={() => setShowSaveAs(false)} />}`

**Keep unchanged:**
- `makeFilename()` helper (move to shared util or keep in App and pass as prop — or just duplicate in SaveAs since it's 5 lines)
- "Copy output to input" button in sidebar (different feature, stays)

### `src/components/App/styles.module.css`

**Remove:** `.captureSection`, `.rec`, `.titleBarBtnActive`

**Keep:** `.titleBarButtons`, `.titleBarBtn` (still used for the single floppy button)

---

## New Dependency

- **`modern-gif`** (MIT, ~8KB gzipped) — GIF encoding via dynamic `import("modern-gif")`

---

## Reused Patterns

| Pattern | Source | Usage in SaveAs |
|---|---|---|
| `<Range>` control | `components/controls/Range.tsx` | Quality, bitrate, frames, FPS sliders |
| `<Enum>` control | `components/controls/Enum.tsx` | Format, codec dropdowns |
| Overlay + dialog shell | `ModalInput/styles.module.css` | `.overlay`, `.dialog`, `.titleBar` |
| Win98 button style | `ModalInput/styles.module.css:57-69` | `.btn` |
| Close button (X) | `ChainList/styles.module.css:280-298` | `.closeBtn` |
| Download via blob | `controls/ColorArray.tsx:270-284` | All download functions |
| Audio track mixing | `App/index.tsx:160-168` | WebM recording with video audio |
| `makeFilename(ext)` | `App/index.tsx:18-23` | Timestamped filenames |

---

## Implementation Order

1. Create `src/components/SaveAs/styles.module.css`
2. Create `src/components/SaveAs/index.tsx` — Image tab only (format, quality, resolution, save, clipboard)
3. Wire into App: add `showSaveAs` state, render dialog, floppy button opens it
4. Add Video tab — WebM recording with codec/bitrate, preview, save
5. Add GIF export (install `modern-gif`, dynamic import)
6. Add PNG sequence export
7. Remove old capture infrastructure from App (state, refs, effects, Capture window, sidebar button)
8. Build + test

---

## Verification

1. **Image save:** Open dialog, save PNG at 1x → downloads. Switch to JPEG at 2x with quality 0.8 → downloads. WebP at 4x → downloads.
2. **Clipboard:** Click "Copy to Clipboard" → paste in external app → correct image at selected resolution.
3. **WebM record:** Video tab, select VP9, 2.5 Mbps → click Record → timer counts → click Stop → preview appears → click Save → downloads `.webm`.
4. **GIF export:** Select GIF, 30 frames, 10 FPS → click Export → progress shows frame count → downloads `.gif`.
5. **Sequence export:** Select Sequence, 10 frames → click Export → 10 numbered PNGs download.
6. **Dimension preview:** Change resolution radio → dimension line updates instantly.
7. **Edge cases:** No image loaded → Save/Copy disabled. Still image, no realtime → Video tab disabled. Large dimensions → warning shown.
8. **Dialog behavior:** Escape closes. Overlay click closes. Prevents close while recording.
9. **Cleanup:** Capture window gone. Sidebar capture button gone. Record button gone. Only floppy button remains on Output title bar.
10. **Mobile:** Dialog full-width, 44px touch targets, all tabs accessible.
