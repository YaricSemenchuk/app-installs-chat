// Установщики приложения (администраторы): загрузить новую версию .dmg и .exe или удалить. Коллеги скачивают на /download.
import { useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Apple, Laptop, Monitor, ShieldAlert, Trash2, Upload } from "lucide-react";
import {
  DesktopVersion,
  INSTALLER_EXT,
  MAX_INSTALLER_BYTES,
  isAdminRole,
  versionFromName,
  type DesktopInfoDto,
  type DesktopPlatform,
  type InstallerDto,
} from "@teamchat/shared";
import { api } from "../api/http";
import { queryClient, useBoot, userName } from "../data/boot";
import { formatBytes } from "../files/kind";
import { putBytes } from "../files/uploads";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { TextField } from "../ui/TextField";
import { toast } from "../ui/Toaster";
import p from "../people/people.module.scss";
import s from "./installers.module.scss";

export const desktopKey = ["desktop"] as const;

export const PLATFORMS: { id: DesktopPlatform; label: string; icon: ReactNode }[] = [
  { id: "mac", label: "macOS", icon: <Apple /> },
  { id: "win", label: "Windows", icon: <Monitor /> },
  { id: "linux", label: "Ubuntu", icon: <Laptop /> },
];
const labelOf = (id: DesktopPlatform) => PLATFORMS.find((x) => x.id === id)!.label;
const dateFmt = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function InstallersPage() {
  const boot = useBoot().data;
  const navigate = useNavigate();
  const me = boot?.me;
  const admin = !!me && isAdminRole(me.role);
  const info = useQuery({ queryKey: desktopKey, queryFn: () => api<DesktopInfoDto>("/desktop"), enabled: admin });
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<DesktopPlatform>("mac");
  const [pending, setPending] = useState<{ platform: DesktopPlatform; file: File } | null>(null);
  const [removing, setRemoving] = useState<InstallerDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!boot || !me) return null;
  if (!admin) {
    return (
      <div className={p.center}>
        <EmptyState
          icon={<ShieldAlert />}
          title="Только для администраторов"
          text="Здесь загружают новые версии приложения. Скачать его можно на странице загрузки"
          action={{ label: "Скачать приложение", onClick: () => navigate("/download") }}
        />
      </div>
    );
  }

  // Тип файла в окне выбора зависит от строки, поэтому accept ставим прямо перед открытием.
  function pick(platform: DesktopPlatform) {
    target.current = platform;
    setError(null);
    if (!input.current) return;
    input.current.accept = INSTALLER_EXT[platform];
    input.current.click();
  }

  function chosen(file: File | undefined) {
    if (!file) return;
    const platform = target.current;
    const ext = INSTALLER_EXT[platform];
    if (!file.name.toLowerCase().endsWith(ext)) return setError(`Для ${labelOf(platform)} нужен файл ${ext}`);
    if (file.size > MAX_INSTALLER_BYTES) return setError("Установщик больше 512 МБ");
    setPending({ platform, file });
  }

  async function remove(it: InstallerDto) {
    setRemoving(null);
    try {
      await api(`/admin/desktop/${it.platform}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: desktopKey });
      toast(`Установщик для ${labelOf(it.platform)} удалён`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className={p.page}>
      <header className={p.header}>
        <div>
          <h1 className={p.pageTitle}>Приложение для компьютера</h1>
          <p className={p.cardMuted}>
            Коллеги скачивают установщики на странице <Link to="/download">загрузки</Link> после входа. Хранится последняя версия для каждой системы.
          </p>
        </div>
      </header>
      {error && (
        <p className={p.error} role="alert">
          {error}
        </p>
      )}

      {info.isPending ? (
        <div className={p.skeletons}>
          {PLATFORMS.map((x) => (
            <Skeleton key={x.id} width="100%" height={52} />
          ))}
        </div>
      ) : (
        <ul className={p.invites}>
          {PLATFORMS.map(({ id, label, icon }) => {
            const it = info.data?.[id] ?? null;
            return (
              <li key={id} className={p.invite}>
                <span className={s.platform}>
                  <span className={s.icon}>{icon}</span>
                  <span className={p.personText}>
                    <span className={p.personName}>
                      {label} <span className={p.cardMuted}>{INSTALLER_EXT[id]}</span>
                    </span>
                    <span className={p.cardMuted}>
                      {it
                        ? `Версия ${it.version} · ${formatBytes(it.size)} · ${dateFmt.format(new Date(it.uploadedAt))}${it.uploadedBy ? ` · ${userName(boot, it.uploadedBy)}` : ""}`
                        : "Ещё не загружен"}
                    </span>
                  </span>
                </span>
                <span className={s.actions}>
                  <Button variant="secondary" size="s" icon={<Upload />} onClick={() => pick(id)}>
                    {it ? "Заменить" : `Загрузить ${INSTALLER_EXT[id]}`}
                  </Button>
                  {it && (
                    <Button variant="dangerGhost" size="s" icon={<Trash2 />} onClick={() => setRemoving(it)}>
                      Удалить
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <section className={p.section}>
        <h2 className={p.sectionTitle}>Как выпустить новую версию</h2>
        <ol className={s.steps}>
          <li>Поднимите version в apps/desktop/package.json.</li>
          <li>Соберите установщики с адресом этого чата: команды — в README, раздел «Десктоп».</li>
          <li>Загрузите .dmg, .exe и .deb сюда. У кого стоит старая версия, приложение предложит обновиться.</li>
        </ol>
      </section>

      <input
        ref={input}
        type="file"
        hidden
        onChange={(e) => {
          chosen(e.target.files?.[0]);
          e.target.value = ""; // тот же файл можно выбрать ещё раз
        }}
      />
      {pending && <UploadDialog key={pending.file.name + pending.file.size} {...pending} onClose={() => setPending(null)} />}
      <Dialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={removing ? `Удалить установщик для ${labelOf(removing.platform)}?` : ""}
        description="Скачать приложение для этой системы будет нельзя, пока не загрузите новую версию. Уже установленные приложения продолжат работать."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Отмена
            </Button>
            <Button variant="danger" onClick={() => removing && void remove(removing)}>
              Удалить
            </Button>
          </>
        }
      />
    </div>
  );
}

function UploadDialog({ platform, file, onClose }: { platform: DesktopPlatform; file: File; onClose: () => void }) {
  const [version, setVersion] = useState(() => versionFromName(file.name) ?? "");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);

  async function upload() {
    const v = version.trim();
    if (!DesktopVersion.safeParse(v).success) return setError("Версия вида 1.0.2 — как в apps/desktop/package.json");
    setError(null);
    setProgress(0);
    try {
      const query = new URLSearchParams({ name: file.name, version: v });
      const done = await putBytes<InstallerDto>(`/api/admin/desktop/${platform}?${query}`, file, setProgress, (x) => (xhr.current = x));
      queryClient.setQueryData<DesktopInfoDto>(desktopKey, (d) => (d ? { ...d, [platform]: done } : d));
      toast(`Версия ${done.version} для ${labelOf(platform)} загружена`);
      onClose();
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message || "Не загрузилось");
      setProgress(null);
    } finally {
      xhr.current = null;
    }
  }

  function cancel() {
    xhr.current?.abort(); // незаконченная загрузка на сервере не останется: файл удаляется при обрыве
    onClose();
  }

  const uploading = progress !== null;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && cancel()}
      title={`Новая версия для ${labelOf(platform)}`}
      description={`${file.name} · ${formatBytes(file.size)}`}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            {uploading ? "Остановить" : "Отмена"}
          </Button>
          <Button onClick={() => void upload()} loading={uploading}>
            Загрузить
          </Button>
        </>
      }
    >
      <TextField
        label="Версия"
        value={version}
        onChange={(e) => setVersion(e.target.value)}
        placeholder="1.0.2"
        hint="Как в apps/desktop/package.json: по ней приложение у коллег предлагает обновиться"
        error={error ?? undefined}
        disabled={uploading}
        data-autofocus
      />
      {uploading && (
        <div className={s.progress} role="progressbar" aria-label="Загрузка" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <span className={s.bar} style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </Dialog>
  );
}
