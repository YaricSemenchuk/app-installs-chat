import { useRef, type ReactElement, type ReactNode } from "react";
import { DropdownMenu as D } from "radix-ui";
import { cx } from "../lib/cx";
import { Kbd } from "./Kbd";
import s from "./Menu.module.scss";

export type MenuEntry =
  | {
      kind: "item";
      label: string;
      icon?: ReactNode;
      kbd?: string;
      danger?: boolean;
      disabled?: boolean;
      // Пункт открывает модалку: меню не возвращает фокус на свою кнопку, иначе оно отберёт его у модалки.
      opensDialog?: boolean;
      onSelect?: () => void;
    }
  | { kind: "separator" };

export function Menu({
  trigger,
  items,
  align = "end",
  onOpenChange,
}: {
  trigger: ReactElement;
  items: MenuEntry[];
  align?: "start" | "end";
  onOpenChange?: (open: boolean) => void;
}) {
  const keepFocus = useRef(false);
  return (
    <D.Root onOpenChange={onOpenChange}>
      <D.Trigger asChild>{trigger}</D.Trigger>
      <D.Portal>
        <D.Content
          className={s.surface}
          sideOffset={4}
          align={align}
          onCloseAutoFocus={(e) => {
            if (keepFocus.current) e.preventDefault();
            keepFocus.current = false;
          }}
        >
          {items.map((it, i) =>
            it.kind === "separator" ? (
              <D.Separator key={i} className={s.separator} />
            ) : (
              <D.Item
                key={i}
                className={cx(s.item, it.danger && s.danger)}
                disabled={it.disabled}
                onSelect={() => {
                  keepFocus.current = Boolean(it.opensDialog);
                  it.onSelect?.();
                }}
              >
                <ItemBody {...it} />
              </D.Item>
            ),
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function ItemBody({ label, icon, kbd }: { label: string; icon?: ReactNode; kbd?: string }) {
  return (
    <>
      <span className={s.icon}>{icon}</span>
      <span className={s.text}>{label}</span>
      {kbd && <Kbd>{kbd}</Kbd>}
    </>
  );
}

// Статичный вид открытого меню для страницы дизайна; highlighted — индекс подсвеченного пункта.
export function MenuSurface({ items, highlighted }: { items: MenuEntry[]; highlighted?: number }) {
  return (
    <div className={s.surface} role="presentation">
      {items.map((it, i) =>
        it.kind === "separator" ? (
          <div key={i} className={s.separator} />
        ) : (
          <div
            key={i}
            className={cx(s.item, it.danger && s.danger)}
            data-highlighted={i === highlighted ? "" : undefined}
            data-disabled={it.disabled ? "" : undefined}
          >
            <ItemBody {...it} />
          </div>
        ),
      )}
    </div>
  );
}
