import { Moon } from "lucide-react";
import { cx } from "../lib/cx";
import s from "./Avatar.module.scss";

export type Presence = "active" | "away" | "dnd";
type Size = "xs" | "s" | "m" | "l" | "xl";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Тон из шести (avatar-1…6) по хэшу id: у человека всегда один и тот же цвет.
function tone(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 6) + 1;
}

const presenceText: Record<Presence, string> = {
  active: "в сети",
  away: "не в сети",
  dnd: "уведомления на паузе",
};

export function Avatar({
  name,
  id = name,
  size = "l",
  src,
  presence,
  deactivated = false,
  decorative = false,
}: {
  name: string;
  id?: string;
  size?: Size;
  src?: string;
  presence?: Presence;
  deactivated?: boolean;
  decorative?: boolean;
}) {
  const label = decorative ? undefined : presence ? `${name}, ${presenceText[presence]}` : name;
  return (
    <span
      className={cx(s.avatar, s[size], deactivated && s.deactivated)}
      role={decorative ? undefined : "img"}
      aria-label={label}
      aria-hidden={decorative || undefined}
    >
      {src ? (
        <img src={src} alt="" className={s.image} />
      ) : (
        <span className={s.initials} style={{ background: `var(--color-avatar-${tone(id)})` }}>
          {size === "xs" ? initials(name).slice(0, 1) : initials(name)}
        </span>
      )}
      {presence && <PresenceDot state={presence} />}
    </span>
  );
}

export function PresenceDot({ state }: { state: Presence }) {
  return (
    <span className={cx(s.presence, s[state])} aria-hidden>
      {state === "dnd" && <Moon strokeWidth={3} />}
    </span>
  );
}

export function AvatarStack({ names, max = 3 }: { names: string[]; max?: number }) {
  return (
    <span className={s.stack} aria-hidden>
      {names.slice(0, max).map((n) => (
        <Avatar key={n} name={n} size="s" decorative />
      ))}
    </span>
  );
}
