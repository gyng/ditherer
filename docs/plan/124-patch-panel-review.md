# Patch-panel UI/UX review

Review the chain audio dialog and patch panel at desktop and phone sizes with
cables routed. Fix concrete defects against the 98.css design system.

## Findings and fixes

- On phones the stacked columns were height-bound, so the left column shrank
  below its content. The "Chain swap timing" options sat under the patch panel.
  Stacked columns now take their content height, and the dialog body scrolls
  once instead of nesting a small patch scroller. A 390×844 regression check
  fails before the fix and passes after it.
- 98.css centers inline-flex labels, so Source and Microphone selects shrank and
  truncated device names. Fields now stretch their selects across the column.
- The input section used a white sunken text-field surface, while the timing
  section below it used a grooved group box. Both now use the group box.
- Hard-coded greys fell to about 4.1:1 contrast on the gray panel and ignored
  themes. They now use `--button-text` and `--muted-text`.

Patch help triggers are 38×34 on phones, matching the shared touch target, and
section counts consistently show connected metrics. No change was needed.

The audio input and accessibility suites pass, including WCAG scans of advanced
surfaces on desktop and phone. Captures are `docs/ui/screenshots/10-*`.
