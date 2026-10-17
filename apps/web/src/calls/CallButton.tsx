// Кнопка звонка в шапке разговора: позвонить (ЛС), начать созвон (канал) или присоединиться к идущему.
import { Headphones, Phone } from "lucide-react";
import { userName, useBoot } from "../data/boot";
import { AvatarStack } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { joinCall, useCalls } from "./store";
import s from "./calls.module.scss";

export function CallButton({ conversationId, dm }: { conversationId: string; dm: boolean }) {
  const boot = useBoot().data;
  const enabled = useCalls((x) => x.enabled);
  const active = useCalls((x) => x.byConversation[conversationId]);
  const mine = useCalls((x) => x.session?.conversationId === conversationId);
  const joining = useCalls((x) => x.joining);
  if (!enabled) return null;

  if (mine) {
    return (
      <span className={s.inCall}>
        <Headphones aria-hidden /> Вы в звонке
      </span>
    );
  }
  if (active && active.participantIds.length > 0) {
    const names = active.participantIds.map((id) => userName(boot, id));
    return (
      <Button size="s" variant="secondary" icon={<Headphones />} loading={joining} onClick={() => void joinCall(conversationId)} aria-label={`Присоединиться к звонку: ${names.join(", ")}`}>
        <AvatarStack names={names} ids={active.participantIds} />
        Присоединиться
      </Button>
    );
  }
  return (
    <IconButton label={dm ? "Позвонить" : "Начать созвон"} size="s" disabled={joining} onClick={() => void joinCall(conversationId)}>
      {dm ? <Phone /> : <Headphones />}
    </IconButton>
  );
}
