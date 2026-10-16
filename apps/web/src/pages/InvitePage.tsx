// S02 — приглашение: кто и куда зовёт, дальше обычный вход с привязкой к приглашению.
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { LinkIcon } from "lucide-react";
import type { InvitePreviewDto } from "@teamchat/shared";
import { api } from "../api/http";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { SignInPage } from "./SignInPage";
import s from "./SignInPage.module.scss";

export function InvitePage() {
  const { token = "" } = useParams();
  const preview = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api<InvitePreviewDto>(`/invites/preview/${encodeURIComponent(token)}`),
    retry: false,
  });

  if (preview.isPending) {
    return (
      <main className={s.page} aria-busy="true">
        <div className={s.card}>
          <Skeleton width="70%" height={20} />
        </div>
      </main>
    );
  }
  if (preview.isError) {
    return (
      <main className={s.page}>
        <div className={s.card}>
          <EmptyState
            icon={<LinkIcon />}
            title="Приглашение не работает"
            text="Срок вышел, его отозвали или им уже воспользовались. Попросите прислать новое"
            action={{ label: "Войти без приглашения", onClick: () => location.assign("/signin") }}
          />
        </div>
      </main>
    );
  }

  const p = preview.data;
  return (
    <SignInPage
      invite={{ token, email: p.email }}
      intro={
        <div className={s.intro}>
          <h1 className={s.title}>Вас зовут в {p.workspaceName}</h1>
          <p className={s.lead}>
            {p.inviterName} приглашает вас в чат команды. Войдите по коду из письма{p.kind === "link" ? " или через Google" : ""}, и вы
            сразу окажетесь в общих каналах.
          </p>
        </div>
      }
    />
  );
}
