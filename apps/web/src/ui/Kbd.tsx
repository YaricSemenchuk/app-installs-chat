import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import s from "./Kbd.module.scss";

export function Kbd({ children, inverse = false }: { children: ReactNode; inverse?: boolean }) {
  return <kbd className={cx(s.kbd, inverse && s.inverse)}>{children}</kbd>;
}
