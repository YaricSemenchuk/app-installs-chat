import { useId, type ReactNode } from "react";
import { Checkbox as C, Switch as S } from "radix-ui";
import { Check, Minus } from "lucide-react";
import s from "./Toggle.module.scss";

type Base = { label: ReactNode; disabled?: boolean };

export function Checkbox({
  label,
  checked,
  onCheckedChange,
  disabled,
}: Base & { checked: boolean | "indeterminate"; onCheckedChange?: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className={s.row}>
      <C.Root
        id={id}
        className={s.checkbox}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange?.(v === true)}
      >
        <C.Indicator className={s.indicator}>
          {checked === "indeterminate" ? <Minus size={12} strokeWidth={3} /> : <Check size={12} strokeWidth={3} />}
        </C.Indicator>
      </C.Root>
      <label htmlFor={id} className={s.label}>
        {label}
      </label>
    </div>
  );
}

export function Switch({
  label,
  checked,
  onCheckedChange,
  disabled,
}: Base & { checked: boolean; onCheckedChange?: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className={s.row}>
      <S.Root id={id} className={s.switch} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange}>
        <S.Thumb className={s.thumb} />
      </S.Root>
      <label htmlFor={id} className={s.label}>
        {label}
      </label>
    </div>
  );
}
