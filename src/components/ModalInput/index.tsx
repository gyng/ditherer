import React, { useState, useRef } from "react";
import WindowDialog from "components/WindowDialog";
import s from "./styles.module.css";

const ModalInput = ({
  title,
  defaultValue = "",
  multiline = false,
  onConfirm,
  onCancel
}: {
  title: string;
  defaultValue?: string;
  multiline?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) => {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !multiline) onConfirm(value);
  };

  return (
    <div className={s.overlay} onMouseDown={onCancel}>
      <WindowDialog
        className={s.dialog}
        title={title}
        onClose={onCancel}
        initialFocusRef={inputRef}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className={s.titleBar}>{title}</div>
        <div className={s.body}>
          {multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              aria-label={title}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label={title}
            />
          )}
          <div className={s.buttons}>
            <button onClick={() => {
              if (navigator.clipboard) {
                navigator.clipboard.writeText(value);
              }
            }}>Copy</button>
            <button onClick={() => onConfirm(value)}>OK</button>
            <button onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </WindowDialog>
    </div>
  );
};

export default ModalInput;
