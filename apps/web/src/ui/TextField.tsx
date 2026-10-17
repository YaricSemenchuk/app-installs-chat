import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import s from "./TextField.module.scss";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> & {
  ref?: Ref<HTMLInputElement>; // React 19: ref — обычный проп, уходит в <input> вместе с rest
  label: string;
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  icon?: ReactNode;
  prefix?: ReactNode;
  size?: "s" | "m";
};

export function TextField({
  label,
  hideLabel = false,
  hint,
  error,
  icon,
  prefix,
  size = "m",
  className,
  id,
  ...rest
}: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const noteId = `${inputId}-note`;
  const note = error ?? hint;

  return (
    <div className={cx(s.field, className)}>
      <label htmlFor={inputId} className={hideLabel ? s.hidden : s.label}>
        {label}
      </label>
      <div className={cx(s.control, s[size], error ? s.invalid : undefined, rest.disabled && s.disabled)}>
        {icon && <span className={s.icon}>{icon}</span>}
        {prefix && <span className={s.prefix}>{prefix}</span>}
        <input
          id={inputId}
          className={s.input}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? noteId : undefined}
          // Метка для Dialog: React не пишет autofocus в DOM, а модалке нужно знать, куда ставить фокус.
          data-autofocus={rest.autoFocus ? "" : undefined}
          {...rest}
        />
      </div>
      {note && (
        <p id={noteId} className={error ? s.error : s.hint}>
          {note}
        </p>
      )}
    </div>
  );
}

type AreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode; error?: ReactNode };

export function TextArea({ label, hint, error, className, id, rows = 3, ...rest }: AreaProps) {
  const autoId = useId();
  const areaId = id ?? autoId;
  const noteId = `${areaId}-note`;
  const note = error ?? hint;
  return (
    <div className={cx(s.field, className)}>
      <label htmlFor={areaId} className={s.label}>
        {label}
      </label>
      <div className={cx(s.control, s.area, error ? s.invalid : undefined)}>
        <textarea
          id={areaId}
          rows={rows}
          className={cx(s.input, s.areaInput)}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? noteId : undefined}
          data-autofocus={rest.autoFocus ? "" : undefined}
          {...rest}
        />
      </div>
      {note && (
        <p id={noteId} className={error ? s.error : s.hint}>
          {note}
        </p>
      )}
    </div>
  );
}
