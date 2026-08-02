import { useId } from "react";
import type { WebMCPStatus } from "@src/webmcp";
import s from "./styles.module.css";

const tooltipText = (status: WebMCPStatus) => {
  if (status.phase === "unsupported") {
    return "WebMCP is unavailable in this browser. In Chrome 150+, enable chrome://flags/#enable-webmcp-testing for local agent tools.";
  }
  if (status.phase === "registering") {
    return `Registering ${status.total} WebMCP agent tools through ${status.api}.modelContext…`;
  }
  if (status.phase === "ready") {
    return `${status.registered} WebMCP agent tools are ready through ${status.api}.modelContext: discover filters and presets, inspect or edit the chain, load media, and export output.`;
  }
  const detail = status.error ? ` ${status.error.slice(0, 180)}` : "";
  if (status.phase === "partial") {
    return `${status.registered} of ${status.total} WebMCP tools registered. Some agent actions are unavailable.${detail}`;
  }
  return `WebMCP is supported, but Ditherer could not register its agent tools.${detail}`;
};

const WebMCPBadge = ({ status }: { status: WebMCPStatus }) => {
  const tooltipId = useId();
  const count =
    status.phase === "ready" || status.phase === "partial"
      ? `${status.registered}/${status.total}`
      : null;

  return (
    <span className={s.webMCPBadgeWrap}>
      <span
        className={s.webMCPBadge}
        data-phase={status.phase}
        data-testid="webmcp-badge"
        tabIndex={0}
        aria-describedby={tooltipId}
        aria-label={`WebMCP status: ${status.phase}`}
      >
        <span className={s.webMCPBadgeLamp} aria-hidden="true" />
        <span>WebMCP</span>
        {count ? <span className={s.webMCPBadgeCount}>{count}</span> : null}
      </span>
      <span id={tooltipId} className={s.webMCPTooltip} role="tooltip">
        {tooltipText(status)}
      </span>
    </span>
  );
};

export default WebMCPBadge;
