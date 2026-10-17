import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { cx } from "../lib/cx";
import { Spinner } from "./Spinner";
import s from "./Button.module.scss";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerGhost";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "s" | "m" | "l";
  icon?: ReactNode;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>; // React 19: доходит до <button> через rest
};

// Во время загрузки кнопку не делаем disabled: браузер снял бы с неё фокус в никуда (body),
// а скринридер потерял бы место. Вместо этого aria-disabled и глушим клик (в том числе submit формы).
export function Button({
  variant = "primary",
  size = "m",
  icon,
  loading = false,
  disabled,
  className,
  children,
  onClick,
  ...rest
}: Props) {
  function click(e: MouseEvent<HTMLButtonElement>) {
    if (loading) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  }
  return (
    <button
      type="button"
      className={cx(s.button, s[size], s[variant], className)}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={click}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : icon}
      <span>{children}</span>
    </button>
  );
}
