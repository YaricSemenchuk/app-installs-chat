// S37 — люди и роли (администраторы): роли, деактивация, активные приглашения.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ShieldAlert, UserMinus, UserPlus, UserRoundCheck } from "lucide-react";
import { canAssignRole, canManageUser, isAdminRole, type AdminUserDto, type InviteDto, type Role } from "@teamchat/shared";
import { api } from "../api/http";
import { adminUsersKey, displayOf, invitesKey, isOnline, queryClient, useBoot, userName } from "../data/boot";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { Menu } from "../ui/Menu";
import { InviteDialog } from "./InviteDialog";
import s from "./people.module.scss";

const roleLabel: Record<Role, string> = {
  primary_owner: "Основной владелец",
  owner: "Владелец",
  admin: "Администратор",
  member: "Участник",
  guest: "Гость",
};
const assignable: Role[] = ["owner", "admin", "member"];
const dateFmt = new Intl.DateTimeFormat("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long" });

export function PeoplePage() {
  const boot = useBoot().data;
  const me = boot?.me;
  const admin = !!me && isAdminRole(me.role);
  const users = useQuery({ queryKey: adminUsersKey, queryFn: () => api<AdminUserDto[]>("/admin/users"), enabled: admin });
  const invites = useQuery({ queryKey: invitesKey, queryFn: () => api<InviteDto[]>("/invites"), enabled: admin });
  const [confirm, setConfirm] = useState<AdminUserDto | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!boot || !me) return null;
  if (!admin) {
    return (
      <div className={s.center}>
        <EmptyState icon={<ShieldAlert />} title="Только для администраторов" text="Здесь управляют людьми и приглашениями. Если нужно кого-то позвать, используйте «Пригласить коллег»" />
      </div>
    );
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: adminUsersKey });
      await queryClient.invalidateQueries({ queryKey: invitesKey });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const people = users.data ?? [];
  const active = people.filter((u) => !u.deactivated);
  const off = people.filter((u) => u.deactivated);

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <h1 className={s.pageTitle}>Люди</h1>
          <p className={s.cardMuted}>
            В команде {active.length}
            {off.length > 0 ? `, отключено ${off.length}` : ""}
          </p>
        </div>
        <Button icon={<UserPlus />} onClick={() => setInviteOpen(true)}>
          Пригласить
        </Button>
      </header>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}

      {users.isPending ? (
        <div className={s.skeletons}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={44} />
          ))}
        </div>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">Человек</th>
              <th scope="col">Роль</th>
              <th scope="col">Был(а) в чате</th>
              <th scope="col">
                <span className={s.hidden}>Действия</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((u) => {
              const manageable = canManageUser(me.role, u.role) && u.id !== me.id;
              const roles = assignable.filter((r) => r !== u.role && canAssignRole(me.role, u.role, r));
              return (
                <tr key={u.id} className={u.deactivated ? s.off : undefined}>
                  <td>
                    <div className={s.person}>
                      <Avatar name={displayOf(u)} id={u.id} size="l" presence={u.deactivated ? undefined : isOnline(boot, u.id) ? "active" : "away"} deactivated={u.deactivated} />
                      <div className={s.personText}>
                        <span className={s.personName}>
                          {u.realName || u.displayName}
                          {u.id === me.id && <span className={s.cardMuted}> (вы)</span>}
                          {!u.onboarded && !u.deactivated && <span className={s.tag}>ещё не заполнил профиль</span>}
                        </span>
                        <span className={s.cardMuted}>{u.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    {roles.length > 0 && !u.deactivated ? (
                      <Menu
                        trigger={
                          <button type="button" className={s.roleButton} aria-label={`Роль: ${roleLabel[u.role]}. Изменить`}>
                            {roleLabel[u.role]}
                            <ChevronDown />
                          </button>
                        }
                        items={roles.map((r) => ({
                          kind: "item" as const,
                          label: `Сделать: ${roleLabel[r].toLowerCase()}`,
                          onSelect: () => void act(() => api(`/admin/users/${u.id}`, { method: "PATCH", body: { role: r } })),
                        }))}
                      />
                    ) : (
                      <span>{u.deactivated ? "Отключён" : roleLabel[u.role]}</span>
                    )}
                  </td>
                  <td className={s.cardMuted}>{u.lastSeenAt ? dateFmt.format(new Date(u.lastSeenAt)) : "ещё не входил(а)"}</td>
                  <td className={s.actions}>
                    {manageable &&
                      (u.deactivated ? (
                        <Button variant="secondary" size="s" icon={<UserRoundCheck />} onClick={() => void act(() => api(`/admin/users/${u.id}/reactivate`, { method: "POST", body: {} }))}>
                          Вернуть доступ
                        </Button>
                      ) : (
                        <Button variant="dangerGhost" size="s" icon={<UserMinus />} onClick={() => setConfirm(u)}>
                          Отключить
                        </Button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Действующие приглашения</h2>
        {invites.data && invites.data.length === 0 && <p className={s.cardMuted}>Сейчас никого не ждём.</p>}
        <ul className={s.invites}>
          {invites.data?.map((i) => (
            <li key={i.id} className={s.invite}>
              <span className={s.personText}>
                <span className={s.personName}>{i.kind === "email" ? i.email : `Ссылка · ${i.useCount} из ${i.maxUses}`}</span>
                <span className={s.cardMuted}>
                  {roleLabel[i.role]} · пригласил(а) {userName(boot, i.invitedBy)} · до {dayFmt.format(new Date(i.expiresAt))}
                </span>
              </span>
              <Button variant="ghost" size="s" onClick={() => void act(() => api(`/invites/${i.id}`, { method: "DELETE" }))}>
                Отозвать
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <Dialog
        open={confirm !== null}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={`Отключить ${confirm ? confirm.realName || confirm.displayName : ""}?`}
        description="Человек сразу выйдет на всех устройствах и из всех каналов. Его сообщения останутся. Доступ можно вернуть в любой момент."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const target = confirm;
                setConfirm(null);
                if (target) void act(() => api(`/admin/users/${target.id}/deactivate`, { method: "POST", body: {} }));
              }}
            >
              Отключить
            </Button>
          </>
        }
      />
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} isAdmin workspace={boot.workspace.name} />
    </div>
  );
}
