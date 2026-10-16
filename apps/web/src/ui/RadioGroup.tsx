import { RadioGroup as R } from "radix-ui";
import s from "./RadioGroup.module.scss";

export type RadioOption<T extends string> = { value: T; label: string; hint?: string; disabled?: boolean };

export function RadioGroup<T extends string>({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string;
  value: T;
  onValueChange: (v: T) => void;
  options: RadioOption<T>[];
}) {
  return (
    <fieldset className={s.fieldset}>
      <legend className={s.legend}>{label}</legend>
      <R.Root className={s.group} value={value} onValueChange={(v) => onValueChange(v as T)}>
        {options.map((o) => (
          <label key={o.value} className={s.option} data-disabled={o.disabled ? "" : undefined}>
            <R.Item value={o.value} className={s.radio} disabled={o.disabled}>
              <R.Indicator className={s.dot} />
            </R.Item>
            <span className={s.text}>
              <span>{o.label}</span>
              {o.hint && <span className={s.hint}>{o.hint}</span>}
            </span>
          </label>
        ))}
      </R.Root>
    </fieldset>
  );
}
