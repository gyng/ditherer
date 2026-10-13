# Pass 04 — manual follow-up

The remaining video telemetry was inside a polite live region. A real-video
regression test demonstrated FPS text in the announced status. Preview status
now groups readable telemetry while only mode and stage-count changes announce.
The fix preserves visible performance information and keyboard scrolling.

Manual contrast calculations found the classic bright title-gradient endpoint
had only 3.97:1 white-text contrast, so a sufficiently long filename could reach
an inaccessible section of the gradient. The default endpoint is now #107abd,
4.62:1 against white (navy is 16.01:1). This small visual adaptation retains the
Windows 98 gradient while meeting the text threshold across its full width.
The subsequent design-system audit will reconcile other local title-bar rules.

The keyboard, error recovery, project round-trip and automated WCAG checks are
being repeated against this state. Two stable full rubric passes are still
required before the design-system audit; this pass found and fixed an issue,
so it does not count as a stable pass.

Release follow-up: the user authorized commit/push after all queued work is
complete. The repository deploys Pages only after successful master push CI.
Filter package publication is a separate filters-v* tag/manual workflow; these
UI changes do not currently alter the filter package release version. CI still
uses Node 20, which is EOL according to the official Node release schedule;
upgrade that runtime in the queued general/release review.
