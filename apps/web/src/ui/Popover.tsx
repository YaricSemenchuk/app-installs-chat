import type { ReactElement, ReactNode } from "react";
import { Popover as P } from "radix-ui";
import s from "./Popover.module.scss";

export function Popover({
  trigger,
  children,
  side = "right",
  label,
}: {
  trigger: ReactElement;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  label: string;
}) {
  return (
    <P.Root>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content className={s.surface} side={side} align="start" sideOffset={8} collisionPadding={16} aria-label={label}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
