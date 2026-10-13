import React, { useRef, useImperativeHandle, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";

import s from "./styles.module.css";

type WindowDialogProps = React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
  title: string;
  onClose: () => void;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  restoreFocus?: boolean;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
};

/** Shared modern modal interaction with retro chrome owned by each surface. */
const WindowDialog = ({
  ref,
  title,
  onClose,
  initialFocusRef,
  restoreFocus = true,
  className,
  children,
  onEscapeKeyDown,
  onKeyDown,
  ...props
}: WindowDialogProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useImperativeHandle(ref, () => rootRef.current!, []);

  useEffect(() => {
    // Radix hides modal backgrounds from assistive technology. Also make those
    // regions natively inert, so their controls cannot receive keyboard focus.
    const madeInert = new Set<HTMLElement>();
    const synchronize = () => {
      const root = rootRef.current;
      if (!root) return;
      const backgrounds = new Set(
        document.querySelectorAll<HTMLElement>('[data-aria-hidden="true"][aria-hidden="true"]'),
      );
      // hideOthers preserves live regions; native modal isolation also covers
      // their containing background controls and scroll panels.
      for (let child: HTMLElement = root; child.parentElement; child = child.parentElement) {
        for (const sibling of child.parentElement.children) {
          if (
            sibling !== child &&
            sibling instanceof HTMLElement &&
            !sibling.matches("script, style, link, [data-radix-popper-content-wrapper]")
          )
            backgrounds.add(sibling);
        }
        if (child.parentElement === document.body) break;
      }
      for (const element of backgrounds) {
        if (element.contains(root) || root?.contains(element)) continue;
        if (!element.inert) {
          madeInert.add(element);
          element.inert = true;
        }
      }
      for (const element of madeInert) {
        if (!backgrounds.has(element)) {
          element.inert = false;
          madeInert.delete(element);
        }
      }
    };
    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "inert"],
    });
    synchronize();
    return () => {
      observer.disconnect();
      for (const element of madeInert) element.inert = false;
    };
  }, []);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content
        {...props}
        ref={rootRef}
        className={[s.dialogContract, className].filter(Boolean).join(" ")}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          returnFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          const preferred =
            initialFocusRef?.current ??
            rootRef.current?.querySelector<HTMLElement>("[data-dialog-initial-focus='true']");
          if (preferred) {
            event.preventDefault();
            preferred.focus({ preventScroll: true });
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (restoreFocus && returnFocusRef.current?.isConnected) {
            returnFocusRef.current.focus({ preventScroll: true });
          }
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={onEscapeKeyDown}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.key !== "Tab" || event.target !== rootRef.current)
            return;
          // Radix cycles focusable controls; also keep an intentionally focused
          // window/root usable when there are no controls or Shift+Tab is used.
          const controls = Array.from(
            rootRef.current.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled):not([type='hidden']), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex='0']",
            ),
          ).filter((element) => !element.closest("[hidden], [aria-hidden='true']"));
          event.preventDefault();
          (event.shiftKey ? controls[controls.length - 1] : controls[0])?.focus({
            preventScroll: true,
          });
          if (!controls.length) rootRef.current.focus({ preventScroll: true });
        }}
      >
        <Dialog.Title className={s.srOnly}>{title}</Dialog.Title>
        {children}
      </Dialog.Content>
    </Dialog.Root>
  );
};

export default WindowDialog;
