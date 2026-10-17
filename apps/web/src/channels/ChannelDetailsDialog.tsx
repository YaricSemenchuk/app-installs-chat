// S08 — детали канала: о канале (тема, описание, название), участники, выход.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { LogOut, UserMinus, UserPlus } from "lucide-react";
import { isAdminRole, normalizeChannelName, type BootDto, type ConversationDto } from "@teamchat/shared";
import { api } from "../api/http";
import { displayOf, isOnline } from "../data/boot";
import { leaveChannel, upsertConversation } from "../data/conversations";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { IconButton } from "../ui/IconButton";
import { Tabs } from "../ui/Tabs";
import { TextField } from "../ui/TextField";
import { PeoplePicker } from "./PeoplePicker";
import s from "./channels.module.scss";

type Tab = "about" | "members";
const dateFmt = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric" });

export function ChannelDetailsDialog({
  boot,
  conv,
  open,
  onOpenChange,
  initialTab = "about",
}: {
  boot: BootDto;
  conv: ConversationDto;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialTab?: Tab;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [name, setName] = useState(conv.name ?? "");
  const [topic, setTopic] = useState(conv.topic);
  const [purpose, setPurpose] = useState(conv.purpose);
  const [adding, setAdding] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setName(conv.name ?? "");
    setTopic(conv.topic);
    setPurpose(conv.purpose);
    setAdding(null);
    setError(null);
    // Сбрасываем форму при каждом открытии, а не при каждом обновлении канала.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const admin = isAdminRole(boot.me.role);
  const manager = conv.isGeneral ? admin : admin || conv.isManager;
  const creator = boot.users.find((u) => u.id === conv.createdBy);
  const archived = conv.archived;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const save = (patch: Record<string, string>) =>
    run(async () => upsertConversation(await api<ConversationDto>(`/conversations/${conv.id}`, { method: "PATCH", body: patch })));

  const members = conv.memberIds
    .map((id) => boot.users.find((u) => u.id === id))
    .filter((u) => u !== undefined)
    .sort((a, b) => displayOf(a).localeCompare(displayOf(b)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="m" title={`#${conv.name}`}>
      <Tabs
        label="Разделы"
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        items={[
          { value: "about", label: "О канале" },
          { value: "members", label: "Участники", count: conv.memberIds.length },
        ]}
      />
      {error && (
        <p role="alert" className={s.footerError}>
          {error}
        </p>
      )}

      {tab === "about" && (
        <div className={s.section}>
          {manager && !archived && (
            <div className={s.fieldRow}>
              <TextField label="Название" value={name} maxLength={160} onChange={(e) => setName(normalizeChannelName(e.target.value))} />
              <Button variant="secondary" disabled={!name || name === conv.name} loading={busy} onClick={() => void save({ name })}>
                Переименовать
              </Button>
            </div>
          )}
          <div className={s.fieldRow}>
            <TextField label="Тема" placeholder="Что сейчас важно в канале" value={topic} maxLength={250} disabled={archived} onChange={(e) => setTopic(e.target.value)} />
            <Button variant="secondary" disabled={topic === conv.topic || archived} loading={busy} onClick={() => void save({ topic })}>
              Сохранить
            </Button>
          </div>
          <div className={s.fieldRow}>
            <TextField label="Описание" placeholder="О чём этот канал" value={purpose} maxLength={250} disabled={archived} onChange={(e) => setPurpose(e.target.value)} />
            <Button variant="secondary" disabled={purpose === conv.purpose || archived} loading={busy} onClick={() => void save({ purpose })}>
              Сохранить
            </Button>
          </div>
          <p className={s.facts}>
            {conv.kind === "private" ? "Закрытый канал" : "Открытый канал"}
            {creator ? ` · создал(а) ${displayOf(creator)}` : ""} · {dateFmt.format(new Date(conv.createdAt))}
          </p>
          {!conv.isGeneral && (
            <div className={s.danger}>
              <Button
                variant="dangerGhost"
                icon={<LogOut />}
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    await leaveChannel(conv.id);
                    onOpenChange(false);
                    navigate("/");
                  })
                }
              >
                Покинуть канал
              </Button>
            </div>
          )}
        </div>
      )}

      {tab === "members" && (
        <div className={s.section}>
          {adding ? (
            <>
              <PeoplePicker boot={boot} selected={adding} onChange={setAdding} exclude={conv.memberIds} />
              <div className={s.fieldRow}>
                <span />
                <Button variant="ghost" onClick={() => setAdding(null)}>
                  Отмена
                </Button>
                <Button
                  disabled={adding.length === 0}
                  loading={busy}
                  onClick={() =>
                    void run(async () => {
                      upsertConversation(await api<ConversationDto>(`/conversations/${conv.id}/members`, { method: "POST", body: { userIds: adding } }));
                      setAdding(null);
                    })
                  }
                >
                  Добавить
                </Button>
              </div>
            </>
          ) : (
            <>
              {!archived && (
                <Button variant="secondary" icon={<UserPlus />} onClick={() => setAdding([])}>
                  Добавить людей
                </Button>
              )}
              <ul className={s.people}>
                {members.map((u) => (
                  <li key={u.id} className={s.memberRow}>
                    <Avatar name={displayOf(u)} id={u.id} size="m" presence={isOnline(boot, u.id) ? "active" : "away"} decorative />
                    <span className={s.personText}>
                      <span>
                        {displayOf(u)}
                        {u.id === boot.me.id && <span className={s.muted}> (вы)</span>}
                      </span>
                      {u.title && <span className={s.muted}>{u.title}</span>}
                    </span>
                    {manager && !conv.isGeneral && u.id !== boot.me.id && (
                      <IconButton
                        label={`Удалить ${displayOf(u)} из канала`}
                        size="xs"
                        onClick={() =>
                          void run(async () =>
                            upsertConversation(await api<ConversationDto>(`/conversations/${conv.id}/members/${u.id}`, { method: "DELETE" })),
                          )
                        }
                      >
                        <UserMinus />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
