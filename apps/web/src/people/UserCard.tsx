// S31 — карточка человека: имя, должность, присутствие, местное время.
import type { UserDto } from "@teamchat/shared";
import { displayOf } from "../data/boot";
import { MessageCircle } from "lucide-react";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import s from "./people.module.scss";

const roleText: Partial<Record<UserDto["role"], string>> = {
  primary_owner: "Основной владелец",
  owner: "Владелец",
  admin: "Администратор",
  guest: "Гость",
};

function localTime(tz: string): string | null {
  try {
    return new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date());
  } catch {
    return null;
  }
}

export function UserCard({ user, online, onMessage }: { user: UserDto; online: boolean; onMessage?: () => void }) {
  const time = localTime(user.tz);
  return (
    <div className={s.card}>
      {onMessage && (
        <div className={s.cardActions}>
          <Button size="s" variant="secondary" icon={<MessageCircle />} onClick={onMessage}>
            Написать
          </Button>
        </div>
      )}
      <Avatar name={displayOf(user)} id={user.id} size="xl" presence={user.deactivated ? undefined : online ? "active" : "away"} deactivated={user.deactivated} />
      <div className={s.cardNames}>
        <h2 className={s.cardName}>{user.realName || user.displayName}</h2>
        {user.realName && user.displayName !== user.realName && <span className={s.cardHandle}>{user.displayName}</span>}
        {user.pronouns && <span className={s.cardMuted}>{user.pronouns}</span>}
      </div>
      {user.title && <p className={s.cardTitle}>{user.title}</p>}
      <dl className={s.cardFacts}>
        {user.deactivated ? (
          <div>
            <dt>Статус</dt>
            <dd>Аккаунт отключён</dd>
          </div>
        ) : (
          <div>
            <dt>Сейчас</dt>
            <dd>{online ? "В сети" : "Не в сети"}</dd>
          </div>
        )}
        {time && !user.deactivated && (
          <div>
            <dt>Местное время</dt>
            <dd>{time}</dd>
          </div>
        )}
        {roleText[user.role] && (
          <div>
            <dt>Роль</dt>
            <dd>{roleText[user.role]}</dd>
          </div>
        )}
        <div>
          <dt>Почта</dt>
          <dd>
            <a href={`mailto:${user.email}`}>{user.email}</a>
          </dd>
        </div>
      </dl>
    </div>
  );
}
