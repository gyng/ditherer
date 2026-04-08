import React, { useState, useRef, useEffect } from "react";
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

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !multiline) onConfirm(value);
    if (e.key === "Escape") onCancel();
  };

  return (
    <div className={s.overlay} onMouseDown={onCancel}>
      <div className={s.dialog} onMouseDown={e => e.stopPropagation()}>
        <div className={s.titleBar}>{title}</div>
        <div className={s.body}>
          {multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
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
      </div>
    </div>
  );
};

export default ModalInput;
