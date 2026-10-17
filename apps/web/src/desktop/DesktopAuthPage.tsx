// Сюда браузер попадает после входа через Google из десктоп-приложения: отдаём код приложению по teamchat://.
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { DESKTOP_PROTOCOL } from "@teamchat/shared";
import s from "../notifications/notifications.module.scss";

export function DesktopAuthPage() {
  const [params] = useSearchParams();
  const code = params.get("code") ?? "";
  const valid = /^[A-Za-z0-9_-]{20,100}$/.test(code);
  const link = `${DESKTOP_PROTOCOL}://auth?code=${code}`;

  useEffect(() => {
    if (valid) window.location.href = link;
  }, [valid, link]);

  return (
    <main className={s.standalone}>
      <div className={s.card}>
        <img className={s.logo} src="/favicon.svg" alt="" />
        {valid ? (
          <>
            <h1>Возвращаемся в приложение</h1>
            <p>Вход выполнен. Если браузер спросит, разрешите открыть приложение. Ссылка действует минуту, эту вкладку потом можно закрыть.</p>
            <p>
              <a href={link}>Открыть приложение</a>
            </p>
          </>
        ) : (
          <>
            <h1>Ссылка не подходит</h1>
            <p>Начните вход заново в самом приложении.</p>
          </>
        )}
      </div>
    </main>
  );
}
