// Свой профиль: имя в сообщениях, полное имя, должность, местоимения.
import { useState } from "react";
import type { UserDto } from "@teamchat/shared";
import { api } from "../api/http";
import { updateBoot, upsertUser } from "../data/boot";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { TextField } from "../ui/TextField";

export function ProfileDialog({ me, open, onOpenChange }: { me: UserDto; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [form, setForm] = useState({ displayName: me.displayName, realName: me.realName, title: me.title, pronouns: me.pronouns });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const user = await api<UserDto>("/me/profile", { method: "PATCH", body: { ...form, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      upsertUser(user);
      updateBoot((b) => ({ ...b, me: user }));
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) setForm({ displayName: me.displayName, realName: me.realName, title: me.title, pronouns: me.pronouns });
        onOpenChange(v);
      }}
      title="Профиль"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={save} loading={busy} disabled={!form.displayName.trim()}>
            Сохранить
          </Button>
        </>
      }
    >
      <TextField label="Как вас называть" maxLength={80} value={form.displayName} onChange={set("displayName")} error={error ?? undefined} />
      <TextField label="Имя и фамилия" maxLength={80} value={form.realName} onChange={set("realName")} />
      <TextField label="Должность" maxLength={100} value={form.title} onChange={set("title")} />
      <TextField label="Местоимения" maxLength={30} placeholder="например, она/её" value={form.pronouns} onChange={set("pronouns")} />
    </Dialog>
  );
}
