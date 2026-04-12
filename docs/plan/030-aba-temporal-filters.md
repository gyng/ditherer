# 030 - ABA temporal filters

## Goal

Add a small set of temporal filters inspired by ABA frame-order cadence and repeated-frame playback artifacts.

## Scope

- Add new main-thread temporal filters that use recent frame history to emulate ABA-style bounce, ghosting, and cadence
- Register the new filters in the main filter registry so they appear in the browser and worker-visible metadata
- Add targeted tests for the new temporal behavior

## Notes

- These filters should stay lightweight and reuse the existing temporal pipeline conventions
- Favor perceptual "ABA-like" motion artifacts over trying to force literal frame insertion in realtime playback
