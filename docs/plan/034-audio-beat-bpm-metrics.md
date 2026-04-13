## 034 — Audio Beat + BPM Metrics

### Goal

Add explicit audio-visualizer metrics for beat hits and detected BPM so they can be patched into filter parameters like the existing level/band metrics.

### Scope

- Add a short-lived `beat` trigger metric for beat-hit modulation.
- Add a `bpm` metric derived from detected beat intervals.
- Expose the new metrics in the audio patch panel.
- Show a human-readable BPM readout on the BPM input card.

### Notes

- Keep the existing `beatHold`, `tempoPhase`, and `beatConfidence` metrics intact.
- Treat BPM as a modulation signal with normalization support, while still surfacing the actual detected BPM to the user.
