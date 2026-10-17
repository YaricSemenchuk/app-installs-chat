import { ArrowLeft, ArrowRight, Bell, LogOut, Search, UserRound } from "lucide-react";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Feedback";
import { IconButton } from "../ui/IconButton";
import { Kbd } from "../ui/Kbd";
import { Menu } from "../ui/Menu";
import s from "./Titlebar.module.scss";

type Props = { me: string; activity: number; onSignOut?: () => void; onProfile?: () => void; onSearch?: () => void };

export function Titlebar({ me, activity, onSignOut, onProfile, onSearch }: Props) {
  return (
    <header className={s.titlebar}>
      <div className={s.nav}>
        <IconButton label="Назад" shortcut="⌘[" size="xs" onClick={() => history.back()}>
          <ArrowLeft />
        </IconButton>
        <IconButton label="Вперёд" shortcut="⌘]" size="xs" onClick={() => history.forward()}>
          <ArrowRight />
        </IconButton>
      </div>
      <button type="button" className={s.search} aria-label="Перейти к разговору или человеку" onClick={onSearch}>
        <Search />
        <span className={s.placeholder}>Перейти к каналу или человеку</span>
        <Kbd>⌘K</Kbd>
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
        <Menu
          trigger={
            <button type="button" className={s.me} aria-label={`${me}: профиль и настройки`}>
              <Avatar name={me} size="m" presence="active" decorative />
            </button>
          }
          items={[
            ...(onProfile ? [{ kind: "item" as const, label: "Профиль", icon: <UserRound />, opensDialog: true, onSelect: onProfile }, { kind: "separator" as const }] : []),
            { kind: "item", label: "Выйти", icon: <LogOut />, onSelect: onSignOut, disabled: !onSignOut },
          ]}
        />
      </div>
    </header>
  );
}
