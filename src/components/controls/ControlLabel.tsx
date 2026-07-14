import { humanizeControlName } from "./labels";
import s from "./styles.module.css";

export const HelpHint = ({ label, text, id }: { label: string; text: string; id?: string | undefined }) => (
  <details className={s.helpHint}>
    <summary
      className={s.info}
      aria-label={`Help for ${label}`}
      title={text}
    >
      ?
    </summary>
    <div id={id} className={s.helpPopover} role="note">{text}</div>
  </details>
);

const valuesMatch = (currentValue: unknown, defaultValue: unknown) => {
  if (Object.is(currentValue, defaultValue)) return true;
  if (Array.isArray(currentValue) && Array.isArray(defaultValue)) {
    return currentValue.length === defaultValue.length
      && currentValue.every((value, index) => Object.is(value, defaultValue[index]));
  }
  return false;
};

const formatDefault = (value: unknown) => {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "On" : "Off";
  return String(value);
};

export const ControlReset = ({
  label,
  currentValue,
  defaultValue,
  onReset,
}: {
  label: string;
  currentValue: unknown;
  defaultValue: unknown;
  onReset: () => void;
}) => (
  <button
    type="button"
    className={s.resetControl}
    disabled={valuesMatch(currentValue, defaultValue)}
    onClick={onReset}
    aria-label={`Reset ${label} to default`}
    title={`Reset to default: ${formatDefault(defaultValue)}`}
  >
    ↶ <span>Reset</span>
  </button>
);

const ControlLabel = ({
  htmlFor,
  name,
  label,
  desc,
  currentValue,
  defaultValue,
  onReset,
}: {
  htmlFor?: string | undefined;
  name: string;
  label?: string | undefined;
  desc?: string | undefined;
  currentValue?: unknown;
  defaultValue?: unknown;
  onReset?: (() => void) | undefined;
}) => {
  const visibleLabel = humanizeControlName(label || name);
  return (
    <div className={s.labelRow}>
      <label className={s.label} htmlFor={htmlFor}>{visibleLabel}</label>
      {desc ? <HelpHint label={visibleLabel} text={desc} id={htmlFor ? `${htmlFor}-help` : undefined} /> : null}
      {defaultValue !== undefined && onReset ? (
        <ControlReset
          label={visibleLabel}
          currentValue={currentValue}
          defaultValue={defaultValue}
          onReset={onReset}
        />
      ) : null}
    </div>
  );
};

export default ControlLabel;
