// После деплоя у файлов сборки новые имена. Вкладка, открытая до деплоя (и десктоп-приложение, которое не
// закрывают днями), просит старый файл и получает 404. Тогда один раз перезагружаемся — придёт свежая сборка.
const KEY = "teamchat.reloadedForBuild";

export function isStaleBuildError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload/i.test(message);
}

// true — перезагрузка пошла. Не чаще раза в минуту, чтобы не уйти в цикл, если файл не грузится по другой причине.
export function reloadForNewBuild(): boolean {
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

// Тяжёлые части (окно звонка, эмодзи) грузим заранее, когда браузеру нечего делать: после деплоя они уже в памяти.
export function prefetchWhenIdle(load: () => Promise<unknown>): void {
  const run = () => void load().catch(() => undefined);
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 10_000 });
  else setTimeout(run, 3000);
}

// Vite сообщает так о файлах, которые не догрузились вместе с ленивым модулем.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadForNewBuild()) event.preventDefault();
});
