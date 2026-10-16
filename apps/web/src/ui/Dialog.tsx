import type { ReactElement, ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cx } from "../lib/cx";
import { IconButton } from "./IconButton";
import s from "./Dialog.module.scss";

type Props = {
  trigger: ReactElement;
  title: string;
  description?: ReactNode;
  size?: "s" | "m" | "l";
  footer?: ReactNode;
  children?: ReactNode;
};

export function Dialog({ trigger, title, description, size = "s", footer, children }: Props) {
  return (
    <D.Root>
      <D.Trigger asChild>{trigger}</D.Trigger>
      <D.Portal>
        <D.Overlay className={s.overlay} />
        <D.Content className={cx(s.surface, s.floating, s[size])}>
          <header className={s.header}>
            <D.Title className={s.title}>{title}</D.Title>
            <D.Close asChild>
              <IconButton label="Закрыть" size="xs">
                <X />
              </IconButton>
            </D.Close>
          </header>
          {description && <D.Description className={s.description}>{description}</D.Description>}
          {children && <div className={s.body}>{children}</div>}
          {footer && <footer className={s.footer}>{footer}</footer>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// Статичный вид модалки для страницы дизайна.
export function DialogSurface({
  title,
  description,
  size = "s",
  footer,
  children,
}: Omit<Props, "trigger">) {
  return (
    <div className={cx(s.surface, s[size])}>
      <header className={s.header}>
        <h2 className={s.title}>{title}</h2>
        <IconButton label="Закрыть" size="xs">
          <X />
        </IconButton>
      </header>
      {description && <p className={s.description}>{description}</p>}
      {children && <div className={s.body}>{children}</div>}
      {footer && <footer className={s.footer}>{footer}</footer>}
    </div>
  );
}
