import type { ReactNode } from "react";
import { Link } from "react-router";
import { ChevronDown, Hash, Lock, Pencil, Plus, Users } from "lucide-react";
import { cx } from "../lib/cx";
import { Avatar, type Presence } from "../ui/Avatar";
import { Badge } from "../ui/Feedback";
import { IconButton } from "../ui/IconButton";
import s from "./Sidebar.module.scss";

export type SidebarEntry =
  | { kind: "channel"; name: string; private?: boolean }
  | { kind: "dm"; name: string; presence?: Presence; self?: boolean }
  | { kind: "group"; names: string[] }
  | { kind: "nav"; label: string; icon: ReactNode };

export type ItemState = {
  unread?: boolean;
  mentions?: number;
  muted?: boolean;
  selected?: boolean;
  draft?: boolean;
  hover?: boolean;
};

export function Sidebar({ workspace, children }: { workspace: string; children: ReactNode }) {
  return (
    <nav className={s.sidebar} aria-label="Разговоры">
      <header className={s.workspace}>
        <button type="button" className={s.workspaceButton}>
          {workspace}
          <ChevronDown />
        </button>
        <IconButton label="Новое сообщение" shortcut="⌘N" size="xs">
          <Pencil />
        </IconButton>
      </header>
      <div className={s.scroll}>{children}</div>
    </nav>
  );
}

export function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={s.section}>
      <div className={s.sectionHeader}>
        <button type="button" className={s.sectionToggle} aria-expanded="true">
          <ChevronDown />
          {title}
        </button>
        <IconButton label={`Добавить в «${title}»`} size="xs" className={s.sectionAdd}>
          <Plus />
        </IconButton>
      </div>
      <ul className={s.list}>{children}</ul>
    </section>
  );
}

function label(entry: SidebarEntry): string {
  switch (entry.kind) {
    case "channel":
    case "dm":
      return entry.name;
    case "group":
      return entry.names.join(", ");
    case "nav":
      return entry.label;
  }
}

export function SidebarItem({ entry, state = {}, to }: { entry: SidebarEntry; state?: ItemState; to?: string }) {
  const { unread, mentions, muted, selected, draft, hover } = state;
  const text = label(entry);
  const aria = [text, mentions ? `${mentions} упоминания` : unread ? "есть непрочитанное" : ""]
    .filter(Boolean)
    .join(", ");
  const className = cx(s.item, unread && !muted && s.unread, muted && s.muted, selected && s.selected, hover && s.hover);
  const linkProps = { className, "aria-current": selected ? ("page" as const) : undefined, "aria-label": aria };

  const content = (
    <>
        <span className={s.lead}>
          {entry.kind === "channel" && (entry.private ? <Lock /> : <Hash />)}
          {entry.kind === "dm" && <Avatar name={entry.name} size="s" presence={entry.presence} decorative />}
          {entry.kind === "group" && (
            <span className={s.groupCount}>
              <Users />
            </span>
          )}
          {entry.kind === "nav" && entry.icon}
        </span>
        <span className={s.label}>
          {text}
          {entry.kind === "dm" && entry.self && <span className={s.self}> (вы)</span>}
        </span>
        {draft && !mentions && <Pencil className={s.draft} aria-label="Черновик" />}
        {mentions ? <Badge count={mentions} /> : null}
    </>
  );

  return (
    <li>
      {to ? (
        <Link to={to} {...linkProps}>
          {content}
        </Link>
      ) : (
        <a href="#" {...linkProps} onClick={(e) => e.preventDefault()}>
          {content}
        </a>
      )}
    </li>
  );
}
