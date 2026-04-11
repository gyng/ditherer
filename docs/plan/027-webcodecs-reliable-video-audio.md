# 027 - WebCodecs reliable video export with audio

## Goal

Ship an end-to-end reliable offline video export path that:

- samples filtered frames at exact timestamps
- encodes video with WebCodecs
- preserves source audio when available
- muxes audio and video into a downloadable WebM

## Scope

- keep existing realtime `MediaRecorder` export for fast/live recording
- keep GIF and PNG sequence export working
- implement reliable loop export for source videos in the Save As dialog
- target WebCodecs plus browser-native decode APIs
- do not add `ffmpeg.wasm`

## Implementation

### 1. Shared offline render primitives

Add `src/components/SaveAs/offlineRender.ts` for:

- timestamp generation
- seek + render readiness waits
- progress updates
- deterministic frame capture

### 2. Reliable video encode

Add `src/components/SaveAs/offlineVideoEncode.ts` for:

- WebCodecs capability checks
- `VideoEncoder` setup
- WebM muxing
- streaming encoded chunks into a final blob

### 3. Source audio preservation

Add `src/components/SaveAs/offlineAudioEncode.ts` for:

- reading the uploaded video source bytes
- decoding source audio when available
- encoding Opus audio for WebM muxing
- aligning audio duration to the exported frame timeline

### 4. Save As integration

Update `src/components/SaveAs/index.tsx` to:

- call the shared offline renderer for reliable loop export
- route reliable loop export into WebCodecs video encoding
- preserve the existing save/copy/preview flow
- surface capability and progress messaging clearly

### 5. Verification

Add focused tests for:

- offline timestamp generation
- duration reconciliation helpers
- reliable export capability logic

Run:

- `npm run test -- --run`
- `npm run build`
