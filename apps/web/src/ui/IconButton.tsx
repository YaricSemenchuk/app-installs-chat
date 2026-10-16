import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";
import { Tooltip } from "./Tooltip";
import s from "./IconButton.module.scss";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  label: string;
  shortcut?: string;
  size?: "xs" | "s";
  pressed?: boolean;
  tone?: "ghost" | "primary";
  children: ReactNode;
};

export function IconButton({
  label,
  shortcut,
  size = "s",
  pressed,
  tone = "ghost",
  className,
  children,
  ...rest
}: Props) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        className={cx(s.button, s[size], s[tone], className)}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
}
