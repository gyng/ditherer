import React, { useState, useRef, useEffect } from "react";
import s from "./styles.module.css";

const isCompact = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches;

const CollapsibleSection = ({
  title,
  children,
  defaultOpen = false,
  collapsible = false,
  forceOpen,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
  forceOpen?: boolean;
}) => {
  const [collapsed, setCollapsed] = useState(() =>
    collapsible ? !defaultOpen : isCompact() && !defaultOpen,
  );
  const [compact, setCompact] = useState(isCompact);
  const contentRef = useRef<HTMLDivElement>(null);
  const canToggle = collapsible || compact;

  // Sync collapsed state when forceOpen changes
  useEffect(() => {
    if (forceOpen !== undefined) {
      setCollapsed(!forceOpen);
    }
  }, [forceOpen]);

  // Re-evaluate collapsed state on resize (e.g., rotating device)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 960px)");
    const handler = (e: MediaQueryListEvent) => {
      setCompact(e.matches);
      if (!e.matches && !collapsible) setCollapsed(false); // always expand static desktop sections
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [collapsible]);

  return (
    <div
      className={[s.section, collapsed ? s.collapsed : "", collapsible ? s.collapsible : ""].join(
        " ",
      )}
    >
      <div
        className={s.header}
        role={canToggle ? "button" : undefined}
        tabIndex={canToggle ? 0 : undefined}
        aria-expanded={canToggle ? !collapsed : undefined}
        onClick={() => {
          if (canToggle) setCollapsed((c) => !c);
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && canToggle) {
            e.preventDefault();
            setCollapsed((c) => !c);
          }
        }}
      >
        <h2>{title}</h2>
        <span className={s.toggle}>{collapsed ? "[+]" : "[-]"}</span>
      </div>
      <div ref={contentRef} className={s.content} style={{ maxHeight: collapsed ? 0 : "none" }}>
        {children}
      </div>
    </div>
  );
};

export default CollapsibleSection;
