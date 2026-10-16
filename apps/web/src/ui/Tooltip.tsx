import type { ReactElement, ReactNode } from "react";
import { Tooltip as T } from "radix-ui";
import { Kbd } from "./Kbd";
import s from "./Tooltip.module.scss";

type Props = {
  label: ReactNode;
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactElement;
};

export function Tooltip({ label, shortcut, side = "top", children }: Props) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className={s.content}>
          <TooltipBody label={label} shortcut={shortcut} />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

// Статичный вид для страницы дизайна.
export function TooltipBody({ label, shortcut }: { label: ReactNode; shortcut?: string }) {
  return (
    <span className={s.body}>
      {label}
      {shortcut && <Kbd inverse>{shortcut}</Kbd>}
    </span>
  );
}

export function TooltipSurface(props: { label: ReactNode; shortcut?: string }) {
  return (
    <span className={s.content}>
      <TooltipBody {...props} />
    </span>
  );
}
