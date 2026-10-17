// S13 — новое ЛС или групповое ЛС: выбираем людей, открываем переписку (существующая откроется сама).
import { useState } from "react";
import { useNavigate } from "react-router";
import { DM_MAX_OTHERS } from "@teamchat/shared";
import { openDm } from "../data/conversations";
import { useBoot } from "../data/boot";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { PeoplePicker } from "./PeoplePicker";
import s from "./channels.module.scss";

export function NewMessageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const boot = useBoot().data;
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close(v: boolean) {
    if (!v) {
      setSelected([]);
      setError(null);
    }
    onOpenChange(v);
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const c = await openDm(selected);
      close(false);
      navigate(`/c/${c.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!boot) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Новое сообщение"
      description={`Один человек — личная переписка, до ${DM_MAX_OTHERS} — общая на всех. Если такая уже есть, откроется она.`}
      footer={
        <>
          {error && (
            <span role="alert" className={s.footerError}>
              {error}
            </span>
          )}
          <Button variant="ghost" onClick={() => close(false)}>
            Отмена
          </Button>
          <Button onClick={start} loading={busy} disabled={selected.length === 0}>
            Открыть переписку
          </Button>
        </>
      }
    >
      <PeoplePicker boot={boot} selected={selected} onChange={setSelected} exclude={[boot.me.id]} max={DM_MAX_OTHERS} label="Кому" />
    </Dialog>
  );
}
