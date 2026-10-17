// Поиск из шапки (⌘G): запрос → страница результатов; рядом — недавние запросы и быстрый переход к людям и каналам.
import { useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { Clock, Hash, Lock, Search, User } from "lucide-react";
import { isChannelKind, matchRank } from "@teamchat/shared";
import { displayOf, isOnline, useBoot } from "../data/boot";
import { openDm } from "../data/conversations";
import { cx } from "../lib/cx";
import { Avatar } from "../ui/Avatar";
import { Dialog } from "../ui/Dialog";
import { Kbd } from "../ui/Kbd";
import { TextField } from "../ui/TextField";
import { recentSearches, rememberSearch } from "./recent";
import cs from "../channels/channels.module.scss";
import s from "./search.module.scss";

type Option =
  | { kind: "search"; id: string; label: string }
  | { kind: "recent"; id: string; label: string }
  | { kind: "channel"; id: string; label: string; private: boolean }
  | { kind: "person"; id: string; label: string };

export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const boot = useBoot().data;
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const q = query.trim();

  const options = useMemo<Option[]>(() => {
    if (!boot) return [];
    if (!q) return recentSearches().map((r) => ({ kind: "recent", id: r, label: r }));
    const channels = boot.conversations
      .filter((c) => isChannelKind(c.kind) && c.name && matchRank(c.name, q) >= 0)
      .slice(0, 3)
      .map((c): Option => ({ kind: "channel", id: c.id, label: c.name!, private: c.kind === "private" }));
    const people = boot.users
      .filter((u) => !u.deactivated && [displayOf(u), u.realName, u.email].some((v) => matchRank(v, q) >= 0))
      .slice(0, 3)
      .map((u): Option => ({ kind: "person", id: u.id, label: displayOf(u) }));
    return [{ kind: "search", id: "search", label: q }, ...channels, ...people];
  }, [boot, q]);

  function close(v: boolean) {
    if (!v) {
      setQuery("");
      setActive(0);
    }
    onOpenChange(v);
  }

  async function choose(o: Option | undefined) {
    if (!o) return;
    close(false);
    if (o.kind === "search" || o.kind === "recent") {
      rememberSearch(o.label);
      navigate(`/search?q=${encodeURIComponent(o.label)}`);
    } else if (o.kind === "channel") navigate(`/c/${o.id}`);
    else navigate(`/c/${(await openDm([o.id])).id}`);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void choose(options[active]);
    }
  }

  if (!boot) return null;
  return (
    <Dialog open={open} onOpenChange={close} title="Поиск по чату">
      <div onKeyDown={onKeyDown}>
        <TextField
          label="Что найти"
          hideLabel
          icon={<Search />}
          placeholder="Слова из сообщений, «точная фраза», -лишнее"
          autoFocus
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="search-options"
          aria-activedescendant={options[active] ? `search-${active}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
      </div>
      <ul id="search-options" role="listbox" className={cs.switcherList} aria-label={q ? "Варианты" : "Недавние запросы"}>
        {!q && options.length === 0 && <li className={cs.hint}>Здесь появятся недавние запросы</li>}
        {!q && options.length > 0 && <li className={s.groupLabel}>Недавние запросы</li>}
        {options.map((o, i) => (
          <li key={`${o.kind}:${o.id}`} id={`search-${i}`} role="option" aria-selected={i === active}>
            <button
              type="button"
              tabIndex={-1}
              className={cx(cs.switcherItem)}
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => void choose(o)}
            >
              {o.kind === "search" ? (
                <Search />
              ) : o.kind === "recent" ? (
                <Clock />
              ) : o.kind === "channel" ? (
                o.private ? (
                  <Lock />
                ) : (
                  <Hash />
                )
              ) : (
                <Avatar name={o.label} id={o.id} size="s" presence={isOnline(boot, o.id) ? "active" : "away"} decorative />
              )}
              <span className={cs.switcherLabel}>{o.kind === "search" ? `Искать «${o.label}» в сообщениях и файлах` : o.label}</span>
              {o.kind === "search" && <Kbd>Enter</Kbd>}
              {o.kind === "person" && <User aria-label="написать" />}
            </button>
          </li>
        ))}
      </ul>
      <p className={s.dialogHint}>
        <Kbd>⌘K</Kbd> — быстро перейти к каналу или человеку
      </p>
    </Dialog>
  );
}
