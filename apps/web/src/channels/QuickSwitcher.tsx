// S27 — быстрый переход (⌘K): каналы, ЛС и люди. Без запроса — сначала непрочитанное.
import { useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { Hash, Lock, Search, User, Users } from "lucide-react";
import { isChannelKind, matchRank } from "@teamchat/shared";
import { displayOf, isOnline, useBoot } from "../data/boot";
import { conversationTitle, openDm } from "../data/conversations";
import { cx } from "../lib/cx";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Feedback";
import { Dialog } from "../ui/Dialog";
import { TextField } from "../ui/TextField";
import s from "./channels.module.scss";

type Item =
  | { kind: "conversation"; id: string; label: string; icon: "channel" | "private" | "dm" | "group"; userId?: string; unread: boolean; badge: number }
  | { kind: "person"; id: string; label: string };

export function QuickSwitcher({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const boot = useBoot().data;
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const items = useMemo<Item[]>(() => {
    if (!boot) return [];
    const q = query.trim();
    const convs: Item[] = boot.conversations.map((c) => {
      const others = c.memberIds.filter((id) => id !== boot.me.id);
      return {
        kind: "conversation",
        id: c.id,
        label: conversationTitle(boot, c),
        icon: isChannelKind(c.kind) ? (c.kind === "private" ? "private" : "channel") : c.kind === "group_dm" ? "group" : "dm",
        userId: c.kind === "dm" ? (others[0] ?? boot.me.id) : undefined,
        unread: c.unreadCount > 0,
        badge: isChannelKind(c.kind) ? c.mentionCount : c.unreadCount,
      };
    });
    // Люди, с кем ещё нет ЛС: выбор откроет новую переписку.
    const withDm = new Set(convs.flatMap((c) => (c.kind === "conversation" && c.userId ? [c.userId] : [])));
    const people: Item[] = boot.users
      .filter((u) => !u.deactivated && !withDm.has(u.id))
      .map((u) => ({ kind: "person", id: u.id, label: displayOf(u) }));
    const all = [...convs, ...people];
    if (!q) {
      return all
        .filter((i) => i.kind === "conversation")
        .sort((a, b) => Number(b.kind === "conversation" && b.unread) - Number(a.kind === "conversation" && a.unread))
        .slice(0, 12);
    }
    return all
      .map((i) => ({ i, rank: matchRank(i.label, q) }))
      .filter((x) => x.rank >= 0)
      .sort((a, b) => a.rank - b.rank)
      .map((x) => x.i)
      .slice(0, 12);
  }, [boot, query]);

  function close(v: boolean) {
    if (!v) {
      setQuery("");
      setActive(0);
    }
    onOpenChange(v);
  }

  async function choose(item: Item | undefined) {
    if (!item) return;
    close(false);
    if (item.kind === "conversation") navigate(`/c/${item.id}`);
    else navigate(`/c/${(await openDm([item.id])).id}`);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void choose(items[active]);
    }
  }

  if (!boot) return null;
  return (
    <Dialog open={open} onOpenChange={close} title="Перейти">
      <div onKeyDown={onKeyDown}>
        <TextField
          label="Куда перейти"
          hideLabel
          icon={<Search />}
          placeholder="Канал, личная переписка или человек"
          autoFocus
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="switcher-list"
          aria-activedescendant={items[active] ? `switcher-${items[active].id}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
      </div>
      <ul id="switcher-list" role="listbox" className={s.switcherList} aria-label="Результаты">
        {items.length === 0 && <li className={s.hint}>Ничего не нашли</li>}
        {items.map((item, i) => (
          <li key={item.id} id={`switcher-${item.id}`} role="option" aria-selected={i === active}>
            <button
              type="button"
              tabIndex={-1}
              className={cx(s.switcherItem, item.kind === "conversation" && item.unread && s.unread)}
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => void choose(item)}
            >
              {item.kind === "person" ? (
                <Avatar name={item.label} id={item.id} size="s" presence={isOnline(boot, item.id) ? "active" : "away"} decorative />
              ) : item.icon === "dm" && item.userId ? (
                <Avatar name={item.label} id={item.userId} size="s" presence={isOnline(boot, item.userId) ? "active" : "away"} decorative />
              ) : item.icon === "group" ? (
                <Users />
              ) : item.icon === "private" ? (
                <Lock />
              ) : (
                <Hash />
              )}
              <span className={s.switcherLabel}>{item.label}</span>
              {item.kind === "person" && <User aria-label="написать" />}
              {item.kind === "conversation" && item.badge > 0 && <Badge count={item.badge} />}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
