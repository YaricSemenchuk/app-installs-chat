// Статичный композер для дизайн-системы. Живой редактор (TipTap) появится в M3.
import {
  AtSign,
  Bold,
  ChevronDown,
  Code,
  Italic,
  Link,
  List,
  ListOrdered,
  Paperclip,
  SendHorizontal,
  Smile,
  SquareCode,
  Strikethrough,
  TextQuote,
} from "lucide-react";
import { cx } from "../lib/cx";
import { IconButton } from "../ui/IconButton";
import { Checkbox } from "../ui/Toggle";
import s from "./Composer.module.scss";

type Props = {
  placeholder: string;
  value?: string;
  toolbar?: boolean;
  broadcastTo?: string;
  typing?: string;
  focused?: boolean;
};

export function Composer({ placeholder, value, toolbar = true, broadcastTo, typing, focused = false }: Props) {
  const empty = !value;
  return (
    <div className={s.wrap}>
      <div className={cx(s.composer, focused && s.focused)}>
        {toolbar && (
          <div className={s.toolbar} role="toolbar" aria-label="Форматирование">
            <IconButton label="Жирный" shortcut="⌘B" size="xs" pressed={false}>
              <Bold />
            </IconButton>
            <IconButton label="Курсив" shortcut="⌘I" size="xs">
              <Italic />
            </IconButton>
            <IconButton label="Зачёркнутый" shortcut="⌘⇧X" size="xs">
              <Strikethrough />
            </IconButton>
            <span className={s.divider} />
            <IconButton label="Ссылка" shortcut="⌘⇧U" size="xs">
              <Link />
            </IconButton>
            <IconButton label="Нумерованный список" shortcut="⌘⇧7" size="xs">
              <ListOrdered />
            </IconButton>
            <IconButton label="Маркированный список" shortcut="⌘⇧8" size="xs">
              <List />
            </IconButton>
            <span className={s.divider} />
            <IconButton label="Цитата" shortcut="⌘⇧9" size="xs">
              <TextQuote />
            </IconButton>
            <IconButton label="Код" shortcut="⌘⇧C" size="xs">
              <Code />
            </IconButton>
            <IconButton label="Блок кода" shortcut="⌘⌥⇧C" size="xs">
              <SquareCode />
            </IconButton>
          </div>
        )}
        <div
          className={cx(s.field, empty && s.placeholder)}
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder}
          tabIndex={0}
        >
          {value ?? placeholder}
        </div>
        <div className={s.bottom}>
          <div className={s.tools}>
            <IconButton label="Прикрепить файл" shortcut="⌘O" size="xs">
              <Paperclip />
            </IconButton>
            <IconButton label="Эмодзи" size="xs">
              <Smile />
            </IconButton>
            <IconButton label="Упомянуть" size="xs">
              <AtSign />
            </IconButton>
          </div>
          <div className={s.send}>
            <IconButton label="Отправить" shortcut="Enter" size="xs" tone="primary" disabled={empty}>
              <SendHorizontal />
            </IconButton>
            <span className={s.sendDivider} />
            <IconButton label="Запланировать отправку" size="xs" tone="primary" disabled={empty}>
              <ChevronDown />
            </IconButton>
          </div>
        </div>
      </div>
      <div className={s.under}>
        {broadcastTo ? (
          <Checkbox label={`Также отправить в #${broadcastTo}`} checked={false} />
        ) : (
          <span className={s.typing}>{typing ?? ""}</span>
        )}
      </div>
    </div>
  );
}
