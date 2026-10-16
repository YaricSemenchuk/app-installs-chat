import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";
import { Spinner } from "./Spinner";
import s from "./Button.module.scss";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerGhost";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "s" | "m" | "l";
  icon?: ReactNode;
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "m",
  icon,
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      className={cx(s.button, s[size], s[variant], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : icon}
      <span>{children}</span>
    </button>
  );
}
