import { useState } from "react";
import { BellRing, Hash, Info, Link2, Pin } from "lucide-react";
import { AvatarStack } from "../ui/Avatar";
import { IconButton } from "../ui/IconButton";
import { Tabs, type TabItem } from "../ui/Tabs";
import s from "./ConversationHeader.module.scss";

export function ConversationHeader({
  name,
  topic,
  members,
  pins,
  bookmark,
}: {
  name: string;
  topic: string;
  members: string[];
  pins?: number;
  bookmark?: string;
}) {
  const [tab, setTab] = useState("messages");
  const tabs: TabItem[] = [{ value: "messages", label: "Сообщения" }];
  if (pins) tabs.push({ value: "pins", label: "Закреплённое", icon: <Pin />, count: pins });
  if (bookmark) tabs.push({ value: "bookmark", label: bookmark, icon: <Link2 /> });

  return (
    <header className={s.header}>
      <div className={s.top}>
        <h1 className={s.title}>
          <Hash />
          {name}
        </h1>
        <p className={s.topic} title={topic}>
          {topic}
        </p>
        <div className={s.actions}>
          <button type="button" className={s.members} aria-label={`Участники: ${members.length}`}>
            <AvatarStack names={members} />
            <span>{members.length}</span>
          </button>
          <IconButton label="Уведомления канала" size="s">
            <BellRing />
          </IconButton>
          <IconButton label="Детали канала" shortcut="⌘⇧I" size="s">
            <Info />
          </IconButton>
        </div>
      </div>
      {tabs.length > 1 && <Tabs label="Разделы канала" value={tab} onValueChange={setTab} items={tabs} />}
    </header>
  );
}
