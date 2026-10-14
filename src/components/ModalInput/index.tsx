import React, { useState, useRef } from "react";
import WindowDialog from "components/WindowDialog";
import controls from "components/controls/styles.module.css";
import s from "./styles.module.css";

const ModalInput = ({
  title,
  defaultValue = "",
  multiline = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  defaultValue?: string;
  multiline?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) => {
  const [value, setValue] = useState(defaultValue);
  const [copying, setCopying] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<"copied" | "failed" | null>(null);
  const copyText = async () => {
    setCopying(true);
    setCopyFeedback(null);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setCopyFeedback("copied");
    } catch {
      setCopyFeedback("failed");
    } finally {
      setCopying(false);
    }
  };
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !multiline) onConfirm(value);
  };

  return (
    <div className={s.overlay} onMouseDown={onCancel}>
      <WindowDialog
        className={[controls.windowFrame, s.dialog].join(" ")}
        title={title}
        onClose={onCancel}
        initialFocusRef={inputRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={[controls.titleBar, controls.windowTitle, s.titleBar].join(" ")}>
          {title}
        </div>
        <div className={s.body}>
          {multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              aria-label={title}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label={title}
            />
          )}
          {copyFeedback && (
            <p className={s.copyFeedback} role={copyFeedback === "failed" ? "alert" : "status"}>
              {copyFeedback === "copied"
                ? "Copied to clipboard."
                : "Copy failed. Select the text and copy it manually."}
            </p>
          )}
          <div className={s.buttons}>
            <button disabled={copying} onClick={copyText}>
              {copying ? "Copying…" : "Copy"}
            </button>
            <button onClick={() => onConfirm(value)}>OK</button>
            <button onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </WindowDialog>
    </div>
  );
};

export default ModalInput;
