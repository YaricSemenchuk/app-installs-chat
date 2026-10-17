// /download — установщики приложения для вошедших и как открыть сборку без подписи.
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router";
import { isAdminRole, type DesktopInfoDto } from "@teamchat/shared";
import { api, isUnauthorized } from "../api/http";
import { useBoot } from "../data/boot";
import { formatBytes } from "../files/kind";
import { rememberReturn } from "../lib/afterSignIn";
import { installerPlatform } from "./bridge";
import { PLATFORMS, desktopKey } from "./InstallersPage";
import s from "../notifications/notifications.module.scss";

export function DownloadPage() {
  const boot = useBoot();
  const info = useQuery({ queryKey: desktopKey, queryFn: () => api<DesktopInfoDto>("/desktop"), enabled: !!boot.data });

  if (boot.error && isUnauthorized(boot.error)) {
    rememberReturn("/download"); // после входа вернём сюда
    return <Navigate to="/signin" replace />;
  }

  const d = info.data;
  const mine = installerPlatform();
  // Своя система — первой.
  const available = PLATFORMS.filter((x) => d?.[x.id]).sort((a, b) => Number(b.id === mine) - Number(a.id === mine));
  const admin = !!boot.data && isAdminRole(boot.data.me.role);
  return (
    <main className={s.standalone}>
      <div className={s.card}>
        <img className={s.logo} src="/favicon.svg" alt="" />
        <h1>Приложение для компьютера</h1>
        <p>То же, что в браузере, плюс значок с непрочитанным, системные уведомления и работа из трея. Сам чат обновляется без переустановки.</p>
        {(boot.isPending || info.isPending) && !boot.error && <p>Загружаем ссылки…</p>}
        {(boot.error || info.error) && <p role="alert">Не удалось загрузить ссылки. Обновите страницу.</p>}
        {d && available.length === 0 && (
          <p>
            Установщики ещё не загружены.{" "}
            {admin ? <Link to="/admin/desktop">Загрузить</Link> : "Их добавляет администратор чата, а пока можно пользоваться браузерной версией."}
          </p>
        )}
        <div className={s.downloads}>
          {available.map(({ id, label, icon }) => {
            const it = d![id]!;
            return (
              <a key={id} className={s.download} href={it.url} download>
                {icon} Скачать для {label}
                <span className={s.downloadMeta}>
                  {it.version} · {formatBytes(it.size)}
                </span>
              </a>
            );
          })}
        </div>
        <p>Сборки не подписаны, поэтому система предупредит при первом запуске:</p>
        <ol className={s.steps}>
          <li>
            macOS (одна сборка для Apple Silicon и Intel): перетащите приложение в «Программы» и откройте. Система скажет, что не может
            проверить разработчика, — нажмите «Готово». Затем «Системные настройки» → «Конфиденциальность и безопасность», внизу у
            сообщения о Promobile Chat нажмите «Всё равно открыть» (Open Anyway) и подтвердите паролем. Это нужно один раз.
          </li>
          <li>Windows: на синем окне SmartScreen нажмите «Подробнее» → «Выполнить в любом случае».</li>
        </ol>
        <p>
          <a href="/">Вернуться в чат</a>
        </p>
      </div>
    </main>
  );
}
