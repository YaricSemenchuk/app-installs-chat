// S03 — каркас: заголовок окна, сайдбар, баннер соединения, текущий экран.
import { useEffect, useState } from "react";
import { Navigate, Outlet, useNavigate, useParams } from "react-router";
import { Bookmark, FileStack, MessageSquareText, SendHorizontal, UserPlus, Users } from "lucide-react";
import { isAdminRole } from "@teamchat/shared";
import { api, isUnauthorized } from "../api/http";
import { Sidebar, SidebarItem, SidebarSection } from "../chat/Sidebar";
import { Titlebar } from "../chat/Titlebar";
import { displayOf, queryClient, useBoot } from "../data/boot";
import { useMessages } from "../data/messages";
import { InviteDialog } from "../people/InviteDialog";
import { ProfileDialog } from "../people/ProfileDialog";
import { startRealtime, stopRealtime, useConnection } from "../realtime/connection";
import { ConnectionBanner, Skeleton } from "../ui/Feedback";
import type { MenuEntry } from "../ui/Menu";
import s from "./AppShell.module.scss";

export function AppShell() {
  const boot = useBoot();
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const status = useConnection((x) => x.status);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const lastEventId = boot.data?.lastEventId;
  const ready = lastEventId !== undefined;

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

  const { me, workspace, conversations } = boot.data;
  if (!me.onboarded) return <Navigate to="/welcome" replace />;

  const admin = isAdminRole(me.role);
  const canInvite = admin || workspace.whoCanInvite === "everyone";
  const channels = conversations
    .filter((c) => c.kind === "public" || c.kind === "private")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  const workspaceMenu: MenuEntry[] = [
    ...(canInvite ? [{ kind: "item" as const, label: "Пригласить коллег", icon: <UserPlus />, onSelect: () => setInviteOpen(true) }] : []),
    ...(admin ? [{ kind: "item" as const, label: "Люди и роли", icon: <Users />, onSelect: () => navigate("/admin/people") }] : []),
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
      <Titlebar me={displayOf(me)} activity={0} onSignOut={signOut} onProfile={() => setProfileOpen(true)} />
      <div className={s.body}>
        <Sidebar workspace={workspace.name} menu={workspaceMenu.length > 0 ? workspaceMenu : undefined}>
          <ul className={s.navList}>
            <SidebarItem entry={{ kind: "nav", label: "Треды", icon: <MessageSquareText /> }} to="/threads" />
            <SidebarItem entry={{ kind: "nav", label: "Черновики и отправленные", icon: <SendHorizontal /> }} to="/drafts" />
            <SidebarItem entry={{ kind: "nav", label: "Сохранённое", icon: <Bookmark /> }} to="/saved" />
            <SidebarItem entry={{ kind: "nav", label: "Файлы", icon: <FileStack /> }} to="/files" />
          </ul>
          <SidebarSection title="Каналы">
            {channels.map((c) => (
              <SidebarItem
                key={c.id}
                to={`/c/${c.id}`}
                entry={{ kind: "channel", name: c.name ?? "", private: c.kind === "private" }}
                state={{ selected: c.id === conversationId, unread: c.unreadCount > 0 }}
              />
            ))}
          </SidebarSection>
          {canInvite && (
            <ul className={s.navList}>
              <li>
                <button type="button" className={s.inviteButton} onClick={() => setInviteOpen(true)}>
                  <UserPlus />
                  Пригласить коллег
                </button>
              </li>
            </ul>
          )}
        </Sidebar>
        <main className={s.main}>
          {(status === "reconnecting" || status === "offline" || status === "restored") && <ConnectionBanner state={status} />}
          <Outlet />
        </main>
      </div>
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} isAdmin={admin} workspace={workspace.name} />
      <ProfileDialog me={me} open={profileOpen} onOpenChange={setProfileOpen} />
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
