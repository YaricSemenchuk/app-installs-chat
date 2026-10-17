// S02 — первый вход: фото, как называть человека и где он работает. Часовой пояс берём из браузера.
import { useState, type SubmitEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import type { UserDto } from "@teamchat/shared";
import { api, isUnauthorized } from "../api/http";
import { updateBoot, upsertUser, useBoot } from "../data/boot";
import { AvatarPicker, type AvatarChoice } from "../people/AvatarPicker";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import s from "./SignInPage.module.scss";

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function OnboardingPage() {
  const boot = useBoot();
  const navigate = useNavigate();
  const me = boot.data?.me;
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [realName, setRealName] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [avatar, setAvatar] = useState<AvatarChoice>(undefined);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (boot.error && isUnauthorized(boot.error)) return <Navigate to="/signin" replace />;
  if (!me) return null;
  if (me.onboarded) return <Navigate to="/" replace />;

  const name = displayName ?? me.displayName;
  const full = realName ?? me.realName;

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api<UserDto>("/me/onboarding", {
        method: "POST",
        body: { displayName: name.trim(), realName: full.trim(), title: title.trim(), tz: browserTz, ...(avatar && { avatarFileId: avatar }) },
      });
      upsertUser(user);
      updateBoot((b) => ({ ...b, me: user }));
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className={s.page}>
      <div className={s.card}>
        <form className={s.form} onSubmit={submit} noValidate>
          <h1 className={s.title}>Расскажите о себе</h1>
          <p className={s.lead}>Так коллеги поймут, кто пишет. Всё можно поменять потом в профиле.</p>
          <AvatarPicker name={full || name || me.email} id={me.id} current={me.avatarUrl} onChange={setAvatar} onBusy={setUploading} />
          <TextField
            label="Как вас называть"
            autoFocus
            maxLength={80}
            value={name}
            onChange={(e) => setDisplayName(e.target.value)}
            hint="Это имя видно в сообщениях"
            error={error ?? undefined}
          />
          <TextField label="Имя и фамилия" maxLength={80} value={full} onChange={(e) => setRealName(e.target.value)} />
          <TextField label="Должность" maxLength={100} placeholder="например, дизайнер" value={title} onChange={(e) => setTitle(e.target.value)} />
          <p className={s.lead}>Часовой пояс: {browserTz}</p>
          <Button type="submit" size="l" loading={busy} disabled={!name.trim() || uploading}>
            Готово, в чат
          </Button>
        </form>
      </div>
    </main>
  );
}
