// Выбор людей: поиск по имени и почте, выбранные — чипами сверху.
import { useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { matchRank, type BootDto, type UserDto } from "@teamchat/shared";
import { displayOf, isOnline } from "../data/boot";
import { cx } from "../lib/cx";
import { Avatar } from "../ui/Avatar";
import { TextField } from "../ui/TextField";
import s from "./channels.module.scss";

type Props = {
  boot: BootDto;
  selected: string[];
  onChange: (ids: string[]) => void;
  exclude?: string[];
  max?: number;
  label?: string;
};

const matches = (u: UserDto, q: string) => [u.displayName, u.realName, u.email].some((v) => matchRank(v, q) >= 0);

export function PeoplePicker({ boot, selected, onChange, exclude = [], max, label = "Кого добавить" }: Props) {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const hidden = new Set(exclude);
  const people = boot.users.filter((u) => !u.deactivated && !hidden.has(u.id) && matches(u, query));
  const full = max !== undefined && selected.length >= max;

  function toggle(id: string) {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else if (!full) {
      onChange([...selected, id]);
      // Выбрали — поиск сбрасываем и возвращаем в него фокус, чтобы сразу искать следующего.
      setQuery("");
      search.current?.focus();
    }
  }

  return (
    <div className={s.picker}>
      {selected.length > 0 && (
        <ul className={s.chips} aria-label="Выбраны">
          {selected.map((id) => {
            const u = boot.users.find((x) => x.id === id);
            if (!u) return null;
            return (
              <li key={id} className={s.chip}>
                <Avatar name={displayOf(u)} id={u.id} size="xs" decorative />
                {displayOf(u)}
                <button type="button" className={s.chipRemove} aria-label={`Убрать ${displayOf(u)}`} onClick={() => toggle(id)}>
                  <X />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <TextField
        ref={search}
        label={label}
        hideLabel
        icon={<Search />}
        placeholder="Имя или почта"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Enter — первый подходящий из ещё не выбранных; форму вокруг не отправляем.
          if (e.key !== "Enter" || !query) return;
          e.preventDefault();
          const first = people.find((u) => !selected.includes(u.id));
          if (first) toggle(first.id);
        }}
        autoFocus
      />
      {full && <p className={s.hint}>Больше {max} человек выбрать нельзя</p>}
      <ul className={s.people} aria-label="Люди">
        {people.length === 0 && <li className={s.hint}>Никого не нашли</li>}
        {people.map((u) => {
          const on = selected.includes(u.id);
          return (
            <li key={u.id}>
              <button type="button" className={cx(s.person, on && s.personOn)} aria-pressed={on} onClick={() => toggle(u.id)} disabled={!on && full}>
                <Avatar name={displayOf(u)} id={u.id} size="m" presence={isOnline(boot, u.id) ? "active" : "away"} decorative />
                <span className={s.personText}>
                  <span>
                    {displayOf(u)}
                    {u.id === boot.me.id && <span className={s.muted}> (вы)</span>}
                  </span>
                  {(u.realName || u.title) && <span className={s.muted}>{[u.realName !== u.displayName ? u.realName : "", u.title].filter(Boolean).join(" · ")}</span>}
                </span>
                {on && <Check className={s.check} />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
