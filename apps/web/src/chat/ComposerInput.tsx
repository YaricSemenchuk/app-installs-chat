// Композер M0: обычный текст, Enter — отправить, Shift+Enter — новая строка.
// Форматирование и автодополнение (TipTap) — в M3.
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { SendHorizontal } from "lucide-react";
import { MESSAGE_MAX_LENGTH } from "@teamchat/shared";
import { cx } from "../lib/cx";
import { IconButton } from "../ui/IconButton";
import s from "./Composer.module.scss";

type Props = { placeholder: string; disabledReason?: string; onSend: (text: string) => void };

export function ComposerInput({ placeholder, disabledReason, onSend }: Props) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const empty = text.trim().length === 0;
  const tooLong = text.length > MESSAGE_MAX_LENGTH;

  // Высота по содержимому, но не больше половины экрана (дальше — прокрутка внутри поля).
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight / 2)}px`;
  }, [text]);

  function submit() {
    if (empty || tooLong || disabledReason) return;
    onSend(text.trim());
    setText("");
    area.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className={s.wrap}>
      <div className={cx(s.composer, disabledReason ? s.disabled : undefined)}>
        <textarea
          ref={area}
          className={cx(s.field, s.textarea)}
          rows={1}
          value={text}
          placeholder={disabledReason ?? placeholder}
          aria-label={placeholder}
          aria-describedby="composer-hint"
          disabled={!!disabledReason}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
        <div className={s.bottom}>
          <span id="composer-hint" className={tooLong ? s.counterError : s.hint}>
            {tooLong
              ? `Слишком длинно: ${text.length.toLocaleString("ru")} из ${MESSAGE_MAX_LENGTH.toLocaleString("ru")} символов`
              : "Enter — отправить, Shift+Enter — новая строка"}
          </span>
          <IconButton label="Отправить" shortcut="Enter" size="xs" tone="primary" disabled={empty || tooLong || !!disabledReason} onClick={submit}>
            <SendHorizontal />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
