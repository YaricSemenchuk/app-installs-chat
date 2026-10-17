// S10 — новый канал. Название приводим к допустимому виду прямо при вводе.
import { useState } from "react";
import { useNavigate } from "react-router";
import { Hash } from "lucide-react";
import { CHANNEL_NAME_MAX, normalizeChannelName, type ConversationDto } from "@teamchat/shared";
import { api } from "../api/http";
import { upsertConversation } from "../data/conversations";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { TextField } from "../ui/TextField";
import { Switch } from "../ui/Toggle";

export function CreateChannelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const [raw, setRaw] = useState("");
  const [purpose, setPurpose] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = normalizeChannelName(raw);

  function close(v: boolean) {
    if (!v) {
      setRaw("");
      setPurpose("");
      setPrivate(false);
      setError(null);
    }
    onOpenChange(v);
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const c = await api<ConversationDto>("/conversations", {
        method: "POST",
        body: { name, kind: isPrivate ? "private" : "public", purpose },
      });
      upsertConversation(c);
      close(false);
      navigate(`/c/${c.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const hint = raw && name !== raw ? `Будет называться #${name}` : "Строчные латинские буквы, цифры, «-» и «_». Кириллицу переведём в латиницу";

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Новый канал"
      description="В канале команда обсуждает одну тему: релизы, дизайн, клиента. Название потом можно поменять."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Отмена
          </Button>
          <Button onClick={create} loading={busy} disabled={!name}>
            Создать
          </Button>
        </>
      }
    >
      <TextField
        label="Название"
        prefix={<Hash />}
        placeholder="например, releases"
        autoFocus
        maxLength={CHANNEL_NAME_MAX * 2}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name && !busy) void create();
        }}
        hint={error ? undefined : hint}
        error={error ?? undefined}
      />
      <TextField label="О чём канал (необязательно)" maxLength={250} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      <Switch
        label="Закрытый канал"
        hint={isPrivate ? "Видят и находят только участники, добавить можно по приглашению" : "Сейчас открытый: любой в команде найдёт его в каталоге и вступит"}
        checked={isPrivate}
        onCheckedChange={setPrivate}
      />
    </Dialog>
  );
}
