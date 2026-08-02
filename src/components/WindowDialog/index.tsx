import React, { useEffect, useId, useRef } from "react";

import s from "./styles.module.css";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const focusableChildren = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getAttribute("aria-hidden") !== "true",
  );

type WindowDialogProps = React.HTMLAttributes<HTMLDivElement> & {
  title: string;
  onClose: () => void;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  restoreFocus?: boolean;
};

/**
 * Accessibility and keyboard contract for the app's draggable retro windows.
 * Visual chrome remains owned by each window so the component can be reused
 * without flattening the established desktop aesthetic.
 */
const WindowDialog = ({
  title,
  onClose,
  initialFocusRef,
  restoreFocus = true,
  className,
  children,
  onKeyDown,
  ...props
}: WindowDialogProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const labelId = useId();

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      const preferred =
        initialFocusRef?.current ??
        root.querySelector<HTMLElement>("[data-dialog-initial-focus='true']") ??
        focusableChildren(root)[0] ??
        root;
      preferred.focus({ preventScroll: true });
    });

    return () => {
      cancelAnimationFrame(frame);
      if (!restoreFocus) return;
      const target = returnFocusRef.current;
      if (target?.isConnected) {
        requestAnimationFrame(() => target.focus({ preventScroll: true }));
      }
    };
  }, [initialFocusRef, restoreFocus]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const root = rootRef.current;
    if (!root) return;
    const items = focusableChildren(root);
    if (items.length === 0) {
      event.preventDefault();
      root.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      {...props}
      ref={rootRef}
      className={[s.dialogContract, className].filter(Boolean).join(" ")}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <span id={labelId} className={s.srOnly}>
        {title}
      </span>
      {children}
    </div>
  );
};

export default WindowDialog;
