import React, { useState, useRef, useEffect } from "react";
import s from "./styles.module.css";

const isMobile = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;

const CollapsibleSection = ({ title, children, defaultOpen = false, collapsible = false, forceOpen }: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
  forceOpen?: boolean;
}) => {
  const [collapsed, setCollapsed] = useState(() =>
    collapsible ? !defaultOpen : (isMobile() && !defaultOpen)
  );
  const contentRef = useRef<HTMLDivElement>(null);

  // Sync collapsed state when forceOpen changes
  useEffect(() => {
    if (forceOpen !== undefined) {
      setCollapsed(!forceOpen);
    }
  }, [forceOpen]);

  // Re-evaluate collapsed state on resize (e.g., rotating device)
  useEffect(() => {
    if (collapsible) return; // collapsible sections manage their own state on all sizes
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent) => {
      if (!e.matches) setCollapsed(false); // always expand on desktop
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [collapsible]);

  return (
    <div className={[s.section, collapsed ? s.collapsed : "", collapsible ? s.collapsible : ""].join(" ")}>
      <div
        className={s.header}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={() => {
          if (collapsible || isMobile()) setCollapsed(c => !c);
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && (collapsible || isMobile())) {
            e.preventDefault();
            setCollapsed(c => !c);
          }
        }}
      >
        <h2>{title}</h2>
        <span className={s.toggle}>{collapsed ? "[+]" : "[-]"}</span>
      </div>
      <div
        ref={contentRef}
        className={s.content}
        style={{ maxHeight: collapsed ? 0 : "none" }}
      >
        {children}
      </div>
    </div>
  );
};

export default CollapsibleSection;
