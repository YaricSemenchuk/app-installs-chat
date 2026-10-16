import { ArrowLeft, ArrowRight, Bell, Search } from "lucide-react";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Feedback";
import { IconButton } from "../ui/IconButton";
import { Kbd } from "../ui/Kbd";
import s from "./Titlebar.module.scss";

export function Titlebar({ me, activity }: { me: string; activity: number }) {
  return (
    <header className={s.titlebar}>
      <div className={s.nav}>
        <IconButton label="Назад" shortcut="⌘[" size="xs">
          <ArrowLeft />
        </IconButton>
        <IconButton label="Вперёд" shortcut="⌘]" size="xs">
          <ArrowRight />
        </IconButton>
      </div>
      <button type="button" className={s.search} aria-label="Поиск по чату">
        <Search />
        <span className={s.placeholder}>Поиск по чату</span>
        <Kbd>⌘G</Kbd>
      </button>
      <div className={s.end}>
        <span className={s.activity}>
          <IconButton label="Активность" shortcut="⌘⇧M" size="s">
            <Bell />
          </IconButton>
          {activity > 0 && (
            <span className={s.activityBadge}>
              <Badge count={activity} />
            </span>
          )}
        </span>
        <button type="button" className={s.me} aria-label="Профиль и настройки">
          <Avatar name={me} size="m" presence="active" decorative />
        </button>
      </div>
    </header>
  );
}
