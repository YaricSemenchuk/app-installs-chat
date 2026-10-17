// S03 — каркас: заголовок окна, сайдбар, баннер соединения, текущий экран.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useNavigate, useParams } from "react-router";
import { Bookmark, Compass, Download, FileStack, Hash, MessageSquareText, MonitorDown, Plus, SendHorizontal, UserPlus, Users } from "lucide-react";
import { isAdminRole, isChannelKind, type BootDto, type ConversationDto } from "@teamchat/shared";
import { api, isUnauthorized } from "../api/http";
import { CreateChannelDialog } from "../channels/CreateChannelDialog";
import { NewMessageDialog } from "../channels/NewMessageDialog";
import { QuickSwitcher } from "../channels/QuickSwitcher";
import { SearchDialog } from "../search/SearchDialog";
import { CallBoundary } from "../calls/CallBoundary";
import { IncomingCall } from "../calls/IncomingCall";
import { useCalls } from "../calls/store";
import { desktop } from "../desktop/bridge";
import { isStaleBuildError, prefetchWhenIdle, reloadForNewBuild } from "../lib/staleBuild";
import { NotifyBanner, UpdateBanner } from "../notifications/Banners";
import { setNavigator } from "../notifications/notify";
import { PreferencesDialog } from "../notifications/PreferencesDialog";
import { Sidebar, SidebarItem, SidebarSection, type SidebarEntry } from "../chat/Sidebar";
import { Titlebar } from "../chat/Titlebar";
import { displayOf, isOnline, queryClient, useBoot } from "../data/boot";
import { conversationTitle, dmPeople, isSelfDm } from "../data/conversations";
import { useMessages } from "../data/messages";
import { loadEmoji } from "../emoji/emoji";
import { InviteDialog } from "../people/InviteDialog";
import { ProfileDialog } from "../people/ProfileDialog";
import { startRealtime, stopRealtime, useConnection } from "../realtime/connection";
import { ConnectionBanner, Skeleton } from "../ui/Feedback";
import type { MenuEntry } from "../ui/Menu";
import { Toaster } from "../ui/Toaster";
import s from "./AppShell.module.scss";

// LiveKit тяжёлый: в начальную загрузку не входит, подгружается в свободное время после старта (см. эффект ниже).
const loadCallWindow = () => import("../calls/CallWindow");
const CallWindow = lazy(() =>
  loadCallWindow()
    .then((m) => ({ default: m.CallWindow }))
    .catch((err: unknown) => {
      // Файл прошлой сборки уже удалён деплоем: перезагрузка подтянет новую.
      if (isStaleBuildError(err) && reloadForNewBuild()) return new Promise<never>(() => undefined);
      throw err;
    }),
);

type Dialog = "invite" | "profile" | "preferences" | "channel" | "message" | "switcher" | "search" | null;

function dmEntry(boot: BootDto, c: ConversationDto): SidebarEntry {
  if (c.kind === "group_dm") return { kind: "group", names: dmPeople(boot, c).map(displayOf) };
  const other = dmPeople(boot, c)[0];
  return {
    kind: "dm",
    name: conversationTitle(boot, c),
    id: (other ?? boot.me).id,
    presence: other && isOnline(boot, other.id) ? "active" : "away",
    self: isSelfDm(boot, c),
  };
}

export function AppShell() {
  const boot = useBoot();
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const status = useConnection((x) => x.status);
  const calls = useCalls((x) => x.byConversation);
  const inCall = useCalls((x) => x.session !== null);
  const callsEnabled = useCalls((x) => x.enabled);
  // Заранее, пока ничего не происходит: после деплоя посреди дня окно звонка и эмодзи уже будут в памяти.
  useEffect(() => prefetchWhenIdle(loadEmoji), []);
  useEffect(() => {
    if (callsEnabled) prefetchWhenIdle(loadCallWindow);
  }, [callsEnabled]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const dialogRef = useRef<Dialog>(null);
  dialogRef.current = dialog;
  const lastEventId = boot.data?.lastEventId;
  const ready = lastEventId !== undefined;
  const close = (v: boolean) => !v && setDialog(null);

  useEffect(() => {
    if (!ready) return;
    return startRealtime(lastEventId, () => {
      stopRealtime();
      queryClient.clear();
      useMessages.getState().reset();
      navigate("/signin", { replace: true });
    });
    // Соединение одно на сессию: не пересоздаём его при обновлении boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Эмодзи нужны реакциям в ленте: подгружаем, как только оболочка готова.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => void loadEmoji(), 300);
    return () => clearTimeout(t);
  }, [ready]);

  // ⌘K / Ctrl+K — быстрый переход откуда угодно, ⌘G / Ctrl+G — поиск по сообщениям и файлам.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      // Поверх чужой модалки (просмотр картинки, подтверждение) переход и поиск не открываем.
      if (dialogRef.current === null && document.querySelector('[role="dialog"]')) return;
      const key = e.key.toLowerCase();
      if (key === "k" || key === "л") {
        e.preventDefault();
        setDialog((d) => (d === "switcher" ? null : "switcher"));
      } else if (key === "g" || key === "п") {
        e.preventDefault();
        setDialog((d) => (d === "search" ? null : "search"));
      } else if (key === "," || key === "б") {
        e.preventDefault();
        setDialog((d) => (d === "preferences" ? null : "preferences"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Клик по уведомлению (браузерному или системному) ведёт сюда, без перезагрузки страницы.
  useEffect(() => setNavigator((path) => navigate(path)), [navigate]);

  // Непрочитанное — в заголовке вкладки и на значке приложения: те же числа, что и бейджи в сайдбаре.
  const badge = (boot.data?.conversations ?? []).reduce((n, c) => n + (isChannelKind(c.kind) ? c.mentionCount : c.unreadCount), 0);
  useEffect(() => {
    const base = boot.data?.workspace.name ? `${boot.data.workspace.name} — чат` : "Чат команды";
    document.title = badge > 0 ? `(${badge}) ${base}` : base;
    desktop?.setBadge(badge);
  }, [badge, boot.data?.workspace.name]);

  if (boot.error && isUnauthorized(boot.error)) return <Navigate to="/signin" replace />;
  if (boot.error) {
    return (
      <div className={s.fatal} role="alert">
        Не удалось загрузить чат: {boot.error.message}.{" "}
        <button type="button" onClick={() => void boot.refetch()}>
          Повторить
        </button>
      </div>
    );
  }
  if (!boot.data) return <ShellSkeleton />;

  const data = boot.data;
  const { me, workspace, conversations } = data;
  if (!me.onboarded) return <Navigate to="/welcome" replace />;

  const admin = isAdminRole(me.role);
  const canInvite = admin || workspace.whoCanInvite === "everyone";
  const channels = conversations.filter((c) => isChannelKind(c.kind)).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  const dms = conversations.filter((c) => !isChannelKind(c.kind)).sort((a, b) => b.latestSeq - a.latestSeq);

  const workspaceMenu: MenuEntry[] = [
    ...(canInvite ? [{ kind: "item" as const, label: "Пригласить коллег", icon: <UserPlus />, opensDialog: true, onSelect: () => setDialog("invite") }] : []),
    ...(admin ? [{ kind: "item" as const, label: "Люди и роли", icon: <Users />, onSelect: () => navigate("/admin/people") }] : []),
    ...(admin ? [{ kind: "item" as const, label: "Приложение для компьютера", icon: <MonitorDown />, onSelect: () => navigate("/admin/desktop") }] : []),
    ...(!desktop ? [{ kind: "item" as const, label: "Скачать приложение", icon: <Download />, onSelect: () => navigate("/download") }] : []),
  ];
  const channelMenu: MenuEntry[] = [
    { kind: "item", label: "Создать канал", icon: <Plus />, opensDialog: true, onSelect: () => setDialog("channel") },
    { kind: "item", label: "Каталог каналов", icon: <Compass />, onSelect: () => navigate("/browse") },
  ];

  async function signOut() {
    await api("/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    stopRealtime();
    queryClient.clear();
    useMessages.getState().reset();
    navigate("/signin", { replace: true });
  }

  return (
    <div className={s.app}>
      <Titlebar
        me={displayOf(me)}
        meId={me.id}
        activity={0}
        onSignOut={signOut}
        onProfile={() => setDialog("profile")}
        onPreferences={() => setDialog("preferences")}
        onSearch={() => setDialog("search")}
      />
      <div className={s.body}>
        <Sidebar workspace={workspace.name} menu={workspaceMenu.length > 0 ? workspaceMenu : undefined} onCompose={() => setDialog("message")}>
          <ul className={s.navList}>
            <SidebarItem entry={{ kind: "nav", label: "Треды", icon: <MessageSquareText /> }} to="/threads" />
            <SidebarItem entry={{ kind: "nav", label: "Черновики и отправленные", icon: <SendHorizontal /> }} to="/drafts" />
            <SidebarItem entry={{ kind: "nav", label: "Сохранённое", icon: <Bookmark /> }} to="/saved" />
            <SidebarItem entry={{ kind: "nav", label: "Файлы", icon: <FileStack /> }} to="/files" />
          </ul>
          <SidebarSection title="Каналы" addLabel="Создать или найти канал" addMenu={channelMenu}>
            {channels.map((c) => (
              <SidebarItem
                key={c.id}
                to={`/c/${c.id}`}
                entry={{ kind: "channel", name: c.name ?? "", private: c.kind === "private" }}
                state={{ selected: c.id === conversationId, unread: c.unreadCount > 0, mentions: c.mentionCount, call: Boolean(calls[c.id]) }}
              />
            ))}
            <SidebarItem entry={{ kind: "nav", label: "Все каналы", icon: <Hash /> }} to="/browse" />
          </SidebarSection>
          <SidebarSection title="Личные сообщения" addLabel="Новое сообщение" onAdd={() => setDialog("message")}>
            {dms.map((c) => (
              <SidebarItem
                key={c.id}
                to={`/c/${c.id}`}
                entry={dmEntry(data, c)}
                state={{ selected: c.id === conversationId, unread: c.unreadCount > 0, mentions: c.unreadCount, call: Boolean(calls[c.id]) }}
              />
            ))}
            {dms.length === 0 && (
              <li>
                <button type="button" className={s.inviteButton} onClick={() => setDialog("message")}>
                  <Plus />
                  Написать коллеге
                </button>
              </li>
            )}
          </SidebarSection>
          {canInvite && (
            <ul className={s.navList}>
              <li>
                <button type="button" className={s.inviteButton} onClick={() => setDialog("invite")}>
                  <UserPlus />
                  Пригласить коллег
                </button>
              </li>
            </ul>
          )}
        </Sidebar>
        <main className={s.main}>
          {(status === "reconnecting" || status === "offline" || status === "restored") && <ConnectionBanner state={status} />}
          {!desktop && <NotifyBanner prefs={data.preferences} />}
          <UpdateBanner />
          <Outlet />
        </main>
      </div>
      <InviteDialog open={dialog === "invite"} onOpenChange={close} isAdmin={admin} workspace={workspace.name} />
      <ProfileDialog me={me} open={dialog === "profile"} onOpenChange={close} />
      <PreferencesDialog open={dialog === "preferences"} onOpenChange={close} />
      <CreateChannelDialog open={dialog === "channel"} onOpenChange={close} />
      <NewMessageDialog open={dialog === "message"} onOpenChange={close} />
      <QuickSwitcher open={dialog === "switcher"} onOpenChange={close} />
      <SearchDialog open={dialog === "search"} onOpenChange={close} />
      {inCall && (
        <CallBoundary>
          <Suspense fallback={null}>
            <CallWindow />
          </Suspense>
        </CallBoundary>
      )}
      <IncomingCall />
      <Toaster />
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className={s.app} aria-busy="true" aria-label="Загрузка чата">
      <div className={s.skeletonBar} />
      <div className={s.body}>
        <div className={s.skeletonSidebar}>
          {[120, 160, 100, 140, 90].map((w, i) => (
            <Skeleton key={i} width={w} height={12} />
          ))}
        </div>
        <div className={s.main} />
      </div>
    </div>
  );
}
