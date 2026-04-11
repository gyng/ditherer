# 026 - Reliable offline video export

## Goal

Create a truly reliable export path for animated/video output by rendering exact frames offline and encoding afterward, instead of depending on realtime playback and `MediaRecorder` timing.

## Why this plan exists

The current export stack has two very different behaviors:

- `recording` uses realtime canvas/video stream capture via `MediaRecorder`
- `gif` and `sequence` already have a more reliable frame-by-frame path via seek/capture

That split is correct, but it means video export is still tied to wall-clock playback behavior. When rendering, seeking, or filter execution is slow, realtime recording can:

- stretch or compress timing
- reflect dropped playback frames
- capture the wrong filtered frame for a source timestamp
- behave differently across browsers

The previous attempt at "reliable render" for video still relied on live recording semantics and was removed because it was not truthful enough.

The reliable path out is to treat video export the same way we treat reliable GIF/sequence export:

1. choose exact output timestamps
2. seek source media to each timestamp
3. wait for the filtered output for that timestamp to settle
4. capture the output frame
5. encode after capture

## Non-goals

- Do not make `MediaRecorder` itself "reliable"
- Do not require WASM as a prerequisite
- Do not replace the existing fast/simple realtime recording path
- Do not promise audio effects processing beyond source-track passthrough in the first version

## Product shape

Add a new export concept in the Video tab:

- `Realtime recording`
- `Reliable offline render`

The user should be able to choose:

- output format: `recording`, `gif`, `sequence`, and eventually `offline video`
- capture method where applicable: `Realtime playback` vs `Reliable seek`

But the important product distinction is this:

- `Realtime recording` is convenient and may include source audio
- `Reliable offline render` is deterministic and timing-first

For the first reliable video version, keep the promise narrow and honest:

- encoded video plus source audio when audio is available
- audio is copied or re-encoded from the source track, not remixed from live playback
- exact output timing from chosen FPS

## Architecture

### 1. Shared offline frame render pipeline

Create a shared offline renderer used by:

- reliable GIF export
- reliable sequence export
- future reliable video export

Suggested module:

- `src/components/SaveAs/offlineRender.ts`

Responsibilities:

- generate target timestamps from duration + FPS
- drive seeks on the source video
- wait for decoded frame + filtered output readiness
- capture the scaled output canvas
- emit progress events with:
  - frame index
  - target time
  - elapsed time
  - ETA
- support cancellation
- optionally support partial results for preview-oriented formats like GIF

Suggested shape:

```ts
export type OfflineFrame = {
  index: number;
  time: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

export type OfflineRenderProgress = {
  phase: "rewind" | "seek" | "render" | "capture" | "encode";
  frameIndex: number;
  frameCount: number;
  targetTime: number;
  etaMs: number | null;
};

export async function renderOfflineFrames(args): Promise<OfflineFrame[]>;
```

### 2. Explicit frame-ready contract

The renderer should stop relying on loose "close enough" checks.

We need a stronger notion of frame readiness for a requested timestamp:

- source video seek completed
- decoded frame metadata matches the requested time within a tight tolerance
- app `state.time` matches the requested time within a cadence-scaled tolerance
- filtered output has re-rendered after that seek

If possible, improve this further by threading a render token through the filter pipeline so `SaveAs` can wait for "render corresponding to requested time T completed" rather than just "some render happened after the seek".

Suggested follow-up touchpoints:

- `src/components/SaveAs/index.tsx`
- `src/context/FilterContext.tsx`
- `src/reducers/filters.ts`

### 3. Offline encoders sit after frame capture

Keep frame rendering separate from output encoding.

Encoders become pluggable consumers of `OfflineFrame[]`:

- GIF encoder
- ZIP/PNG sequence writer
- video encoder
- audio muxer for reliable video output

That separation lets us improve reliability once and reuse it everywhere.

### 4. Audio track handling for reliable video

Reliable video export should preserve source audio when present.

Preferred approach:

- read the source media audio track directly rather than recording speaker output
- keep offline frame sampling authoritative for video timing
- trim or pad encoded audio during muxing so final duration matches the exported frame timeline

Suggested module:

- `src/components/SaveAs/offlineAudioEncode.ts`

Responsibilities:

- inspect whether the source media includes an audio track
- decode or demux source audio into a predictable buffer/stream
- encode audio into the chosen container-compatible format when needed
- hand encoded audio chunks plus timing metadata to the final muxing step

First-version scope:

- preserve the source track for reliable video exports when the input contains audio
- no filter-aware audio processing
- no microphone capture
- no audio export for GIF/sequence

## Reliable video export path

### Phase 1: canonical reliable output = sequence

Treat PNG sequence export as the ground-truth reliable export.

Why:

- easiest to verify
- easiest to debug
- no muxing/container complexity
- useful even before offline video encoding exists

Work:

- move current reliable sequence logic onto the shared offline renderer
- keep staged `Save` / `Copy` flow
- improve progress UI with explicit phases

### Phase 2: offline video encode via WebCodecs

Preferred browser-native path:

- create `VideoFrame`s from captured canvases or `ImageData`
- feed them to `VideoEncoder` with exact timestamps
- extract and encode source audio with matching timeline metadata
- mux audio and video encoded chunks into WebM if supported by chosen muxing path

Suggested module:

- `src/components/SaveAs/offlineVideoEncode.ts`
- `src/components/SaveAs/offlineAudioEncode.ts`

Why WebCodecs first:

- deterministic timestamps
- better fit than `MediaRecorder`
- browser-native performance profile

Constraints:

- browser support varies
- muxing still requires careful handling
- audio decode/encode support is less uniform than video encode support
- output should be offered only when capability checks pass

### Phase 3: capability-gated rollout

If WebCodecs is unavailable:

1. keep reliable video disabled
2. steer users to reliable sequence/GIF export

Recommendation:

- target WebCodecs only for offline video
- keep unsupported-browser behavior simple and explicit
- validate the architecture with sequence + WebCodecs

## UI plan

### Video tab copy

Make the distinction obvious:

- `Record` / `Record loop`
  - label and help text describe realtime capture
- `Render loop`
  - label and help text describe offline deterministic export

Avoid overloading one button with two mental models.

### Suggested controls

For reliable/offline render:

- `FPS`
- `Resolution`
- `Output`
  - `PNG sequence`
  - `GIF`
  - `Video` when supported
- `Audio`
  - `Include source audio` when supported and present
- `Strict frame validation`
- `Retry suspicious frames` (advanced, optional)

### Status display

Reliable export should show structured progress:

- `Rewinding`
- `Seeking frame 17/120`
- `Waiting for filtered render`
- `Capturing pixels`
- `Encoding video`
- `Encoding audio`
- `Muxing`
- ETA

This will make timing bugs much easier to diagnose.

## Reliability hardening

### 1. Suspicious frame detection

During offline render, detect likely bad captures:

- repeated frame when timestamp advanced unexpectedly
- rendered timestamp mismatch
- output freshness token did not advance

Allow one retry before failing the frame.

### 2. Duplicate-frame policy

Support format-specific handling:

- GIF may collapse duplicates into longer delays
- video should usually keep exact cadence unless user opts into dedupe
- sequence should preserve every sampled frame exactly

### 3. Determinism mode for filters

Some temporal filters may need export-aware behavior if they depend on realtime playback rather than `_frameIndex` or source time.

Audit filters that may behave differently under offline stepping, especially:

- feedback/persistence filters
- motion-analysis filters
- filters that read previous frame state

Potential addition:

- `_exportMode: "realtime" | "offline"`
- `_exportTime`

Only add this if the audit shows genuine mismatches.

## Implementation phases

### Phase A - refactor reliable GIF/sequence onto shared renderer

Files likely touched:

- `src/components/SaveAs/index.tsx`
- `src/components/SaveAs/offlineRender.ts` (new)

Deliverables:

- shared timestamp sampler
- shared seek/render/capture loop
- shared progress callbacks
- existing GIF preview still works
- sequence still stages ZIP output

### Phase B - strengthen frame-ready signaling

Files likely touched:

- `src/components/SaveAs/index.tsx`
- `src/context/FilterContext.tsx`
- `src/reducers/filters.ts`

Deliverables:

- tighter timestamp matching
- render token or equivalent readiness signal
- retry path for suspicious frames

### Phase C - ship reliable sequence as the canonical offline export

Deliverables:

- polished progress states
- cancellation
- clear result staging
- help text that explains this is the most trustworthy export path

### Phase D - add offline video encode behind capability check

Files likely touched:

- `src/components/SaveAs/index.tsx`
- `src/components/SaveAs/offlineVideoEncode.ts` (new)
- `src/components/SaveAs/offlineAudioEncode.ts` (new)
- optional utility modules for WebCodecs/muxing

Deliverables:

- reliable offline video render with source audio when available
- staged save flow like GIF/video
- explicit unsupported-browser fallback to sequence

## Risks

- Browser support for WebCodecs and muxing differs
- Browser audio decode/encode support may differ from video support
- Some temporal filters may not behave identically under seek-driven offline stepping
- Memory pressure can spike if we buffer too many full frames before encoding
- Canvas readback remains expensive, so reliability does not automatically mean speed

## Mitigations

- Prefer streaming encode over buffering all frames when possible
- Keep sequence export available as the fallback truth path
- Stage work so shared offline frame capture lands before offline video encode
- Gate reliable video UI behind real capability checks
- If audio support is missing, make the UI explicit about whether export falls back to mute video or disables reliable video entirely

## Verification

### Manual

- Compare reliable GIF vs reliable sequence on the same short loop
- Verify no duration stretching when render time per frame is slow
- Verify deterministic reruns produce visually identical results for the same settings
- Verify cancellation works during seek, render, and encode phases
- Verify staged save/preview flows remain intact
- Verify exported video audio stays in sync at start, midpoint, and end
- Verify silent inputs still export correctly

### Automated

Add focused tests where practical for:

- timestamp generation
- progress phase transitions
- cancellation
- suspicious-frame retry policy
- duplicate-frame collapse policy for GIF
- audio/video duration reconciliation
- muxing behavior with and without source audio

Run:

- `npm run lint`
- `npm run test -- --run`
- `npm run build`

## Recommendation

Treat reliable sequence export as the canonical offline render product first, then layer reliable video on top of the same frame renderer.

That keeps us honest:

- reliability comes from exact sampled frames
- speed improvements are additive
- WebCodecs is an implementation detail layered on top of the shared renderer rather than the foundation
