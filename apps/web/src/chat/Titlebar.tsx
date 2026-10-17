import { ArrowLeft, ArrowRight, Bell, ChevronLeft, LogOut, Search, Settings, UserRound } from "lucide-react";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Feedback";
import { IconButton } from "../ui/IconButton";
import { Kbd } from "../ui/Kbd";
import { Menu } from "../ui/Menu";
import s from "./Titlebar.module.scss";

type Props = {
  me: string;
  meId?: string;
  activity: number;
  onSignOut?: () => void;
  onProfile?: () => void;
  onPreferences?: () => void;
  onSearch?: () => void;
  onHome?: () => void; // телефон: вернуться к списку разговоров
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function Titlebar({ me, meId, activity, onSignOut, onProfile, onPreferences, onSearch, onHome }: Props) {
  return (
    <header className={s.titlebar}>
      {onHome && (
        <span className={s.home}>
          <IconButton label="К списку разговоров" size="s" onClick={onHome}>
            <ChevronLeft />
          </IconButton>
        </span>
      )}
      <div className={s.nav}>
        <IconButton label="Назад" shortcut="⌘[" size="xs" onClick={() => history.back()}>
          <ArrowLeft />
        </IconButton>
        <IconButton label="Вперёд" shortcut="⌘]" size="xs" onClick={() => history.forward()}>
          <ArrowRight />
        </IconButton>
      </div>
      <button type="button" className={s.search} aria-label="Поиск по чату" onClick={onSearch}>
        <Search />
        <span className={s.placeholder}>Поиск по чату</span>
        <span className={s.kbd}>
          <Kbd>{isMac ? "⌘G" : "Ctrl+G"}</Kbd>
        </span>
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
              <Avatar name={me} id={meId} size="m" presence="active" decorative />
            </button>
          }
          items={[
            ...(onProfile ? [{ kind: "item" as const, label: "Профиль", icon: <UserRound />, opensDialog: true, onSelect: onProfile }] : []),
            ...(onPreferences
              ? [{ kind: "item" as const, label: "Настройки", icon: <Settings />, kbd: isMac ? "⌘," : "Ctrl+,", opensDialog: true, onSelect: onPreferences }]
              : []),
            ...(onProfile || onPreferences ? [{ kind: "separator" as const }] : []),
            { kind: "item", label: "Выйти", icon: <LogOut />, onSelect: onSignOut, disabled: !onSignOut },
          ]}
        />
      </div>
    </header>
  );
}
