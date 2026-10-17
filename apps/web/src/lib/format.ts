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

// «1 участник», «3 участника», «5 участников».
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${n} ${word}`;
}
