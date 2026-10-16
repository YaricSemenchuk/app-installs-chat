// Мелкие компоненты обратной связи: Badge, Skeleton, EmptyState, Banner, Toast.
import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, WifiOff } from "lucide-react";
import { cx } from "../lib/cx";
import { Button } from "./Button";
import { Spinner } from "./Spinner";
import s from "./Feedback.module.scss";

export function Badge({ count, variant = "mention" }: { count: number; variant?: "mention" | "muted" }) {
  return <span className={cx(s.badge, s[variant])}>{count > 99 ? "99+" : count}</span>;
}

export function Skeleton({ width, height, round = false }: { width: number | string; height: number; round?: boolean }) {
  return <span className={cx(s.skeleton, round && s.round)} style={{ width, height }} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: { label: string; onClick?: () => void };
}) {
  return (
    <div className={s.empty}>
      <span className={s.emptyIcon}>{icon}</span>
      <h3 className={s.emptyTitle}>{title}</h3>
      <p className={s.emptyText}>{text}</p>
      {action && (
        <Button variant="secondary" size="s" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export type BannerState = "reconnecting" | "offline" | "restored";

const bannerText: Record<BannerState, string> = {
  reconnecting: "Переподключаемся…",
  offline: "Нет сети. Сообщения уйдут, когда связь вернётся",
  restored: "Связь восстановлена",
};

export function ConnectionBanner({ state }: { state: BannerState }) {
  return (
    <div className={cx(s.banner, s[state])} role="status" aria-live="polite">
      {state === "reconnecting" && <Spinner size={14} label="" />}
      {state === "offline" && <WifiOff />}
      {state === "restored" && <CircleCheck />}
      {bannerText[state]}
    </div>
  );
}

export function ToastSurface({
  text,
  tone = "info",
  action,
}: {
  text: string;
  tone?: "info" | "error";
  action?: string;
}) {
  return (
    <div className={s.toast} role="status">
      {tone === "error" && <CircleAlert className={s.toastError} />}
      <span>{text}</span>
      {action && (
        <button type="button" className={s.toastAction}>
          {action}
        </button>
      )}
    </div>
  );
}
