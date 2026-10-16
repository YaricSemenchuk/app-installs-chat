// IANA-зона из браузера; неизвестное значение не сохраняем. Проверяем через Intl, а не по списку
// supportedValuesOf: в списке ICU бывают только старые имена (Europe/Kiev), а браузер шлёт новые (Europe/Kyiv).
export function validTimeZone(tz: string | undefined): string | undefined {
  if (!tz || tz.length > 64) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}
