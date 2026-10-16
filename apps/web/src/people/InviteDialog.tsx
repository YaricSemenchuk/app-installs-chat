// S36 — пригласить коллег: письма на адреса, для админов ещё ссылка-приглашение.
import { useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { INVITE_EMAILS_PER_REQUEST, isEmail, type InviteLinkDto, type InviteResultDto } from "@teamchat/shared";
import { api } from "../api/http";
import { invitesKey, queryClient } from "../data/boot";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { RadioGroup } from "../ui/RadioGroup";
import { TextArea } from "../ui/TextField";
import s from "./people.module.scss";

const statusText: Record<InviteResultDto["results"][number]["status"], string> = {
  sent: "приглашение отправлено",
  already_member: "уже в команде",
  deactivated: "аккаунт отключён — верните доступ в «Людях»",
};

function parseEmails(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

export function InviteDialog({ open, onOpenChange, isAdmin, workspace }: { open: boolean; onOpenChange: (v: boolean) => void; isAdmin: boolean; workspace: string }) {
  const [raw, setRaw] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<InviteResultDto["results"] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const emails = parseEmails(raw);
  const invalid = emails.filter((e) => !isEmail(e));
  const tooMany = emails.length > INVITE_EMAILS_PER_REQUEST;

  function reset(next: boolean) {
    if (!next) {
      setRaw("");
      setResults(null);
      setError(null);
      setLink(null);
      setCopied(false);
      setRole("member");
    }
    onOpenChange(next);
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<InviteResultDto>("/invites", { method: "POST", body: { emails, role } });
      setResults(res.results);
      setRaw("");
      void queryClient.invalidateQueries({ queryKey: invitesKey });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function makeLink() {
    setBusy(true);
    setLinkError(null);
    try {
      const res = await api<InviteLinkDto>("/invites/link", { method: "POST", body: {} });
      setLink(res.url);
      void queryClient.invalidateQueries({ queryKey: invitesKey });
    } catch (err) {
      setLinkError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={reset}
      size="m"
      title={`Пригласить в ${workspace}`}
      description="Пришлём письмо со ссылкой. По ней коллега войдёт и сразу попадёт в общие каналы."
      footer={
        <>
          <Button variant="ghost" onClick={() => reset(false)}>
            Закрыть
          </Button>
          <Button onClick={send} loading={busy} disabled={emails.length === 0 || invalid.length > 0 || tooMany}>
            Отправить приглашения
          </Button>
        </>
      }
    >
      <TextArea
        label="Почта коллег"
        placeholder="anna@company.com, oleg@company.com"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={3}
        autoFocus
        hint={emails.length > 0 && !tooMany && invalid.length === 0 ? `Адресов: ${emails.length}` : "Через запятую, пробел или с новой строки"}
        error={
          invalid.length > 0
            ? `Не похоже на адрес: ${invalid.slice(0, 3).join(", ")}`
            : tooMany
              ? `Не больше ${INVITE_EMAILS_PER_REQUEST} адресов за раз`
              : (error ?? undefined)
        }
      />
      {isAdmin && (
        <RadioGroup
          label="Роль"
          value={role}
          onValueChange={setRole}
          options={[
            { value: "member", label: "Участник", hint: "пишет в каналы, приглашает коллег" },
            { value: "admin", label: "Администратор", hint: "ещё управляет людьми и приглашениями" },
          ]}
        />
      )}
      {results && (
        <ul className={s.results} aria-live="polite">
          {results.map((r) => (
            <li key={r.email}>
              <strong>{r.email}</strong> — {statusText[r.status]}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && (
        <div className={s.linkBox}>
          <div className={s.linkText}>
            <strong>Ссылка-приглашение</strong>
            <span>Для тех, чьих адресов нет под рукой: 30 дней, до 100 человек. Отозвать можно в «Людях».</span>
          </div>
          {link ? (
            <div className={s.linkRow}>
              <code className={s.linkUrl}>{link}</code>
              <Button variant="secondary" size="s" icon={copied ? <Check /> : <Copy />} onClick={copy}>
                {copied ? "Скопировано" : "Копировать"}
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="s" icon={<Link2 />} onClick={makeLink} loading={busy}>
              Создать ссылку
            </Button>
          )}
          {linkError && (
            <p className={s.error} role="alert">
              {linkError}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
