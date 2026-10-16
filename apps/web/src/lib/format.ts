const time = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" });
const dayThisYear = new Intl.DateTimeFormat("ru", { weekday: "long", day: "numeric", month: "long" });
const dayOtherYear = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric" });
const full = new Intl.DateTimeFormat("ru", { dateStyle: "long", timeStyle: "short" });

export const formatTime = (iso: string) => time.format(new Date(iso));
export const formatFull = (iso: string) => full.format(new Date(iso));

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  const label = d.getFullYear() === now.getFullYear() ? dayThisYear.format(d) : dayOtherYear.format(d);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
