import { useState, type ReactNode } from "react";
import { BellRing, Hash, Info, Link2, Pin } from "lucide-react";
import { AvatarStack } from "../ui/Avatar";
import { IconButton } from "../ui/IconButton";
import { Tabs, type TabItem } from "../ui/Tabs";
import s from "./ConversationHeader.module.scss";

export function ConversationHeader({
  name,
  icon = <Hash />,
  topic,
  members,
  memberIds,
  call,
  pins,
  bookmark,
  onDetails,
  onMembers,
}: {
  name: string;
  icon?: ReactNode;
  topic: string;
  members?: string[];
  memberIds?: string[];
  call?: ReactNode; // кнопка звонка (calls/CallButton)
  pins?: number;
  bookmark?: string;
  onDetails?: () => void;
  onMembers?: () => void;
}) {
  const [tab, setTab] = useState("messages");
  const tabs: TabItem[] = [{ value: "messages", label: "Сообщения" }];
  if (pins) tabs.push({ value: "pins", label: "Закреплённое", icon: <Pin />, count: pins });
  if (bookmark) tabs.push({ value: "bookmark", label: bookmark, icon: <Link2 /> });

  return (
    <header className={s.header}>
      <div className={s.top}>
        <h1 className={s.title}>
          {onDetails ? (
            <button type="button" className={s.titleButton} onClick={onDetails}>
              {icon}
              {name}
            </button>
          ) : (
            <>
              {icon}
              {name}
            </>
          )}
        </h1>
        <p className={s.topic} title={topic}>
          {topic}
        </p>
        <div className={s.actions}>
          {call}
          {members && (
            <button type="button" className={s.members} aria-label={`Участники: ${members.length}`} onClick={onMembers}>
              <AvatarStack names={members} ids={memberIds} />
              <span>{members.length}</span>
            </button>
          )}
          <IconButton label="Уведомления" size="s">
            <BellRing />
          </IconButton>
          {onDetails && (
            <IconButton label="Детали" shortcut="⌘⇧I" size="s" onClick={onDetails}>
              <Info />
            </IconButton>
          )}
        </div>
      </div>
      {tabs.length > 1 && <Tabs label="Разделы канала" value={tab} onValueChange={setTab} items={tabs} />}
    </header>
  );
}
