// Композер: обычный текст, Enter — отправить, Shift+Enter — новая строка, «@» — упомянуть.
// Выбранное упоминание видно как «@Имя», а при отправке превращается в токен с id.
// Форматирование (TipTap) — в M3.
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AtSign, Megaphone, SendHorizontal } from "lucide-react";
import { MESSAGE_MAX_LENGTH, matchRank, mentionToken } from "@teamchat/shared";
import { cx } from "../lib/cx";
import { Avatar } from "../ui/Avatar";
import { IconButton } from "../ui/IconButton";
import s from "./Composer.module.scss";

export type Mentionable =
  | { kind: "user"; id: string; label: string; hint?: string }
  | { kind: "here" | "channel"; label: string; hint: string };

type Props = { placeholder: string; disabledReason?: string; mentionables?: Mentionable[]; onSend: (text: string) => void };
type Query = { text: string; start: number };

const QUERY_RE = /(?:^|\s)@([^\s@]{0,30})$/u;
const MAX_OPTIONS = 8;

export function ComposerInput({ placeholder, disabledReason, mentionables = [], onSend }: Props) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState<Query | null>(null);
  const [active, setActive] = useState(0);
  const mentions = useRef(new Map<string, string>()); // «@Имя» → токен
  const area = useRef<HTMLTextAreaElement>(null);
  const empty = text.trim().length === 0;
  const tooLong = text.length > MESSAGE_MAX_LENGTH;

  const options = useMemo(() => {
    if (!query) return [];
    const rank = (m: Mentionable) => {
      const byLabel = matchRank(m.label, query.text);
      // По подсказке тоже: «@ка» найдёт @channel («все в канале»), «@Бонд» — Марка по фамилии.
      const byHint = m.hint ? matchRank(m.hint, query.text) : -1;
      return byLabel < 0 ? byHint : byHint < 0 ? byLabel : Math.min(byLabel, byHint);
    };
    return mentionables
      .map((m) => ({ m, r: rank(m) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r)
      .map((x) => x.m)
      .slice(0, MAX_OPTIONS);
  }, [query, mentionables]);
  const open = options.length > 0;

  // Высота по содержимому, но не больше половины экрана (дальше — прокрутка внутри поля).
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight / 2)}px`;
  }, [text]);

  function detect(value: string, caret: number) {
    const m = value.slice(0, caret).match(QUERY_RE);
    if (m) {
      setQuery({ text: m[1] ?? "", start: caret - (m[1]?.length ?? 0) - 1 });
      setActive(0);
    } else setQuery(null);
  }

  function choose(option: Mentionable | undefined) {
    const el = area.current;
    if (!option || !query || !el) return;
    const label = `@${option.label}`;
    mentions.current.set(label, option.kind === "user" ? mentionToken.user(option.id) : mentionToken[option.kind]);
    const caret = el.selectionStart;
    const next = `${text.slice(0, query.start)}${label} ${text.slice(caret)}`;
    const pos = query.start + label.length + 1;
    setText(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  // «@Имя» → токен; длинные метки раньше коротких, чтобы «@Аня» не съела часть «@Аня К».
  function encode(value: string): string {
    let out = value;
    for (const [label, token] of [...mentions.current].sort((a, b) => b[0].length - a[0].length)) {
      out = out.split(label).join(token);
    }
    return out;
  }

  function submit() {
    if (empty || tooLong || disabledReason) return;
    onSend(encode(text.trim()));
    setText("");
    setQuery(null);
    mentions.current.clear();
    area.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (e.key === "ArrowDown" ? (a + 1) % options.length : (a - 1 + options.length) % options.length));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(options[active]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className={s.wrap}>
      <div className={cx(s.composer, disabledReason ? s.disabled : undefined)}>
        {open && (
          <ul className={s.mentions} role="listbox" id="mention-list" aria-label="Кого упомянуть">
            {options.map((o, i) => (
              <li key={o.kind === "user" ? o.id : o.kind} role="option" aria-selected={i === active} id={`mention-${i}`}>
                <button
                  type="button"
                  tabIndex={-1}
                  className={s.mentionOption}
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault(); // не забираем фокус у поля
                    choose(o);
                  }}
                >
                  {o.kind === "user" ? <Avatar name={o.label} id={o.id} size="s" decorative /> : <Megaphone />}
                  <span className={s.mentionLabel}>{o.kind === "user" ? o.label : `@${o.label}`}</span>
                  {o.hint && <span className={s.mentionHint}>{o.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={area}
          className={cx(s.field, s.textarea)}
          rows={1}
          value={text}
          placeholder={disabledReason ?? placeholder}
          aria-label={placeholder}
          aria-describedby="composer-hint"
          aria-autocomplete="list"
          aria-controls={open ? "mention-list" : undefined}
          aria-activedescendant={open ? `mention-${active}` : undefined}
          disabled={!!disabledReason}
          onChange={(e) => {
            setText(e.target.value);
            detect(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) => detect(text, e.currentTarget.selectionStart)}
          onBlur={() => setQuery(null)}
          onKeyDown={onKeyDown}
          autoFocus
        />
        <div className={s.bottom}>
          <div className={s.tools}>
            <IconButton
              label="Упомянуть"
              size="xs"
              disabled={!!disabledReason}
              onClick={() => {
                const el = area.current;
                if (!el) return;
                const caret = el.selectionStart;
                const before = text.slice(0, caret);
                const insert = before && !/\s$/.test(before) ? " @" : "@";
                const next = before + insert + text.slice(caret);
                setText(next);
                detect(next, caret + insert.length);
                requestAnimationFrame(() => {
                  el.focus();
                  el.setSelectionRange(caret + insert.length, caret + insert.length);
                });
              }}
            >
              <AtSign />
            </IconButton>
            <span id="composer-hint" className={tooLong ? s.counterError : s.hint}>
              {tooLong
                ? `Слишком длинно: ${text.length.toLocaleString("ru")} из ${MESSAGE_MAX_LENGTH.toLocaleString("ru")} символов`
                : "Enter — отправить, Shift+Enter — новая строка, @ — упомянуть"}
            </span>
          </div>
          <IconButton label="Отправить" shortcut="Enter" size="xs" tone="primary" disabled={empty || tooLong || !!disabledReason} onClick={submit}>
            <SendHorizontal />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
