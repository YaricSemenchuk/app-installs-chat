// Входящий звонок в ЛС: карточка с «Принять» и «Отклонить», звук, а в фоне — системное уведомление.
// Не ответили за CALL_RING_SECONDS — карточка исчезает, звонящему решит его собственный таймер.
import { useEffect } from "react";
import { Phone, PhoneOff } from "lucide-react";
import { userName, useBoot } from "../data/boot";
import { conversationTitle } from "../data/conversations";
import { show } from "../notifications/notify";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toaster";
import { startRingtone } from "./sound";
import { acceptIncoming, declineIncoming, useCalls } from "./store";
import s from "./calls.module.scss";

export function IncomingCall() {
  const boot = useBoot().data;
  const incoming = useCalls((x) => x.incoming);
  const callId = incoming?.call.id;
  const from = incoming ? userName(boot, incoming.from) : "";

  useEffect(() => {
    if (!incoming) return;
    const stop = startRingtone();
    if (document.visibilityState !== "visible" || !document.hasFocus()) {
      show(`${from} звонит`, "Откройте чат, чтобы ответить", `/c/${incoming.call.conversationId}`, false, `call-${incoming.call.id}`);
    }
    const missed = setTimeout(() => {
      if (useCalls.getState().incoming?.call.id !== incoming.call.id) return;
      useCalls.setState({ incoming: null });
      toast(`Пропущенный звонок: ${from}`);
    }, Math.max(0, incoming.until - Date.now()));
    return () => {
      stop();
      clearTimeout(missed);
    };
    // Перезапуск только для нового звонка: имя и прочее не меняются за время вызова.
  }, [callId]);

  if (!incoming || !boot) return null;
  const conv = boot.conversations.find((c) => c.id === incoming.call.conversationId);
  const group = conv?.kind === "group_dm";
  return (
    <div className={s.incoming} role="alertdialog" aria-labelledby="incoming-call-title" aria-describedby="incoming-call-text">
      <Avatar name={from} id={incoming.from} size="xl" decorative />
      <div className={s.incomingText}>
        <p id="incoming-call-title" className={s.incomingTitle}>
          {from}
        </p>
        <p id="incoming-call-text" className={s.muted}>
          {group && conv ? `Звонок в «${conversationTitle(boot, conv)}»` : "Звонит вам"}
        </p>
      </div>
      <div className={s.incomingActions}>
        <Button variant="danger" size="s" icon={<PhoneOff />} onClick={() => void declineIncoming()}>
          Отклонить
        </Button>
        <Button size="s" icon={<Phone />} onClick={() => void acceptIncoming()} autoFocus>
          Принять
        </Button>
      </div>
    </div>
  );
}
