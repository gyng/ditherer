## 025 Mobile Sidebar Compaction

### Objective

Make the mobile sidebar feel intentionally compact so the filter chain remains visible and usable without forcing users to scroll past an oversized input section first.

This pass is specifically about **mobile vertical density**, not a broad redesign of the desktop layout or the sidebar information architecture.

### Current Problem

On narrow screens, the input/sidebar region consumes too much height before the filter chain appears. In practice:

- the mobile sidebar reserves too much vertical space at the top of the page
- the input area has more vertical padding and control height than the mobile viewport comfortably supports
- the test media controls are dense horizontally but still expensive vertically in the surrounding layout
- the filter chain, which is the primary editing surface, is pushed too far down the sidebar

The result is that the first meaningful chain interaction is hidden or delayed on common phone heights.

### Success Criteria

The mobile layout should satisfy all of the following:

- the filter chain becomes visible significantly earlier on first load
- the input section still exposes the essential controls needed to get started
- the sidebar remains scrollable and legible on short mobile viewports
- desktop layout remains visually unchanged
- no new mobile-only interaction model is introduced unless simple compaction is insufficient

More concretely, the mobile experience should feel like:

- the user can see the start of the chain editor without having to mentally “get through” an oversized input block first
- the first screenful communicates both “load media” and “edit chain” instead of overwhelmingly prioritizing only loading controls
- loading controls remain easy to hit, but no longer dominate the viewport

### Non-Goals

- redesigning the desktop sidebar
- changing filter-chain functionality
- inventing a new drawer, tab system, or custom mobile-only navigation pattern unless absolutely necessary
- restyling the UI away from the existing retro visual language

### Areas To Review

- `src/components/App/index.tsx`
  - input section structure
  - grouping/order of controls shown above the chain
  - whether any controls are unnecessarily prominent on mobile

- `src/components/App/styles.module.css`
  - mobile `@media` rules for `.chrome`
  - mobile padding, gaps, and control sizing
  - input/test media layout behavior
  - sticky filter button behavior and how much space it consumes

- `src/components/ChainList/index.tsx` and `src/components/ChainList/styles.module.css`
  - whether the chain starts high enough in the sidebar flow
  - whether chain spacing is balanced appropriately once the input section is compacted

### Implementation Strategy

#### 1. Audit The Mobile Vertical Budget

Measure which elements are spending the most height in the mobile sidebar:

- sidebar top padding and section spacing
- input group chrome and nested group spacing
- file picker height
- test media row height and wrapping behavior
- input scale/video controls when a video is loaded
- sticky filter button height and padding

The goal of this audit is to decide whether the main issue is:

- sidebar container sizing
- oversized controls and spacing
- content order
- or a combination of all three

This audit should produce a rough ranked list of the worst vertical offenders before any code changes are made.

#### 2. Compact The Input Section First

Prefer the least disruptive fixes:

- reduce mobile-only padding and margins
- tighten group spacing
- reduce control heights where readability remains acceptable
- reduce extra whitespace around the file picker and test media controls
- make the test media cluster denser if it can save height without becoming confusing

This step should preserve the current interaction model as much as possible.

The preferred first pass is:

- CSS-only spacing reduction
- mobile-only control sizing changes
- mobile-only row wrapping or denser arrangement for test media controls

without changing what the controls do.

#### 3. Rebalance Sidebar Height Allocation

Once the controls are denser, adjust the mobile sidebar container so the chain appears sooner:

- revisit the mobile `max-height` on `.chrome`
- confirm the scroll boundary still feels natural
- ensure the filter chain is not trapped below an overly tall input section
- verify the sticky filter button does not consume excessive visible space

If needed, bias the layout toward showing the top of the chain earlier, even if it means the input section scrolls sooner.

#### 4. Apply Structural Compaction Only If Necessary

If spacing-only improvements are not enough, use small structural changes before inventing anything custom:

- move lower-priority controls below the chain
- collapse secondary controls behind an existing section boundary
- defer non-essential mobile chrome until after the chain becomes visible

Any structural change should be justified by clear viewport savings.

Structural changes should be treated as escalation, not the default.

#### 5. Validate On Realistic Mobile Heights

Review the result against short and typical mobile viewport heights and confirm:

- the chain is visible earlier on load
- the input section still works without awkward wrapping or clipped controls
- video-specific controls do not explode the sidebar height
- the desktop layout is unaffected

The validation bar should explicitly include:

- a short phone-height case where the chain is visible near the top of the sidebar flow
- a loaded-video case, since video controls increase input-section height the most
- a no-restored-state case, since default media loading can affect first-load height and perceived startup balance

### Open Decisions

These are the main decisions to resolve during implementation:

1. Should the primary fix come from reducing `.chrome` height usage or reducing the input section’s internal height?
   - Preferred bias: reduce internal height first, then tune container height if needed.

2. Should the test media controls stay fully expanded on mobile?
   - Preferred bias: keep them visible, but make the row denser before considering any collapse.

3. Should video-only controls remain above the chain on mobile?
   - Preferred bias: keep the most essential playback controls visible, but consider moving lower-priority controls if video mode still dominates the viewport.

4. Should the sticky filter button keep the same mobile prominence?
   - Preferred bias: preserve the feature, but reduce its vertical cost if it is stealing too much space.

5. Is markup reordering necessary, or can CSS-only compaction solve the problem?
   - Preferred bias: solve with CSS first, reorder markup only if the height savings are materially better.

### Risks

- Over-compacting controls could make the input area feel cramped or harder to tap.
- Moving controls too aggressively could damage discoverability for first-time users.
- Tuning only the container height without shrinking the input internals could just move the scrolling problem rather than solving it.
- Special-casing mobile too heavily could create maintenance drift between desktop and mobile behavior.

### Decision Rules

When choosing between options:

- prefer CSS compaction over markup changes
- prefer markup reordering over adding new interaction patterns
- prefer preserving visible chain access over preserving generous whitespace
- prefer consistency with the current Win95-style UI over polished-but-off-theme mobile conventions
- prefer reversible, low-complexity changes over introducing a new interaction branch

### Deliverables

- mobile-specific sidebar/input compaction changes in `App`
- any small supporting chain layout adjustments if needed
- verification via build and responsive review

### Expected Result

After this pass, the mobile sidebar should feel more balanced:

- the input area should read as a compact launch panel rather than the dominant section of the page
- the filter chain should be reachable immediately or with minimal scrolling on common phone heights
- the page should retain the current retro desktop character while behaving more intentionally on mobile

If the first pass succeeds, the implementation should feel like a cleanup of the existing UI rather than a noticeable redesign.
