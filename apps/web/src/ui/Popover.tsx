import type { ReactElement, ReactNode } from "react";
import { Popover as P } from "radix-ui";
import { cx } from "../lib/cx";
import s from "./Popover.module.scss";

// Без open — открывается кликом по trigger; с open/onOpenChange — управляемый (например, по горячей клавише).
export function Popover({
  trigger,
  children,
  side = "right",
  align = "start",
  label,
  open,
  onOpenChange,
  bare = false,
}: {
  trigger: ReactElement;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  bare?: boolean; // без внутренних отступов: содержимое само решает (пикер эмодзи)
}) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          className={cx(s.surface, bare && s.bare)}
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={16}
          aria-label={label}
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
