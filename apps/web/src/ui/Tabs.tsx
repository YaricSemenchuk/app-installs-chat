import type { ReactNode } from "react";
import { Tabs as T } from "radix-ui";
import { cx } from "../lib/cx";
import s from "./Tabs.module.scss";

export type TabItem = { value: string; label: ReactNode; icon?: ReactNode; count?: number };

export function Tabs({
  items,
  value,
  onValueChange,
  variant = "underline",
  label,
}: {
  items: TabItem[];
  value: string;
  onValueChange: (v: string) => void;
  variant?: "underline" | "pills";
  label: string;
}) {
  return (
    <T.Root value={value} onValueChange={onValueChange}>
      <T.List className={cx(s.list, s[variant])} aria-label={label}>
        {items.map((it) => (
          <T.Trigger key={it.value} value={it.value} className={s.tab}>
            {it.icon}
            {it.label}
            {it.count !== undefined && <span className={s.count}>{it.count}</span>}
          </T.Trigger>
        ))}
      </T.List>
    </T.Root>
  );
}
