// S01 — вход по коду из письма или через Google. Со страницы приглашения (S02) приходит invite.
import { useState, type ReactNode, type SubmitEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import type { AuthProvidersDto, UserDto } from "@teamchat/shared";
import { api, ApiError } from "../api/http";
import { bootKey, queryClient } from "../data/boot";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import s from "./SignInPage.module.scss";
import { desktop } from "../desktop/bridge";

type Step = { kind: "email" } | { kind: "code"; email: string };
export type InviteContext = { token: string; email: string | null };

const googleErrors: Record<string, string> = {
  no_access: "У этого аккаунта Google нет доступа. Попросите приглашение у администратора",
  unverified: "Google не подтвердил этот адрес почты. Войдите по коду из письма",
  denied: "Вход через Google отменён",
  state: "Сессия входа устарела. Попробуйте ещё раз",
  exchange: "Google не ответил. Попробуйте ещё раз или войдите по коду",
  unknown: "Не получилось войти через Google. Попробуйте ещё раз",
  desktop: "Ссылка для входа в приложение устарела. Нажмите «Войти через Google» ещё раз",
};

export function SignInPage({ invite, intro }: { invite?: InviteContext; intro?: ReactNode }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const providers = useQuery({ queryKey: ["auth", "providers"], queryFn: () => api<AuthProvidersDto>("/auth/providers") });
  const [step, setStep] = useState<Step>({ kind: "email" });
  const [email, setEmail] = useState(invite?.email ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const googleError = params.get("error");
  const [error, setError] = useState<string | null>(googleError ? (googleErrors[googleError] ?? googleErrors.unknown!) : null);
  const [desktopWaiting, setDesktopWaiting] = useState(false);
  const [resent, setResent] = useState(false);
  const emailLocked = Boolean(invite?.email);

  async function requestCode(address: string) {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/email/start", { method: "POST", body: { email: address, ...(invite ? { inviteToken: invite.token } : {}) } });
      setStep({ kind: "code", email: address.trim().toLowerCase() });
      setCode("");
    } catch (err) {
      setError(err instanceof ApiError && err.status === 400 ? "Проверьте адрес почты" : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onEmail(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    await requestCode(email);
  }

  async function onCode(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step.kind !== "code") return;
    setBusy(true);
    setError(null);
    try {
      await api<{ user: UserDto }>("/auth/email/verify", { method: "POST", body: { email: step.email, code } });
      queryClient.removeQueries({ queryKey: bootKey });
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const googleHref = `/api/auth/google/start${invite ? `?invite=${encodeURIComponent(invite.token)}` : ""}`;

  return (
    <main className={s.page}>
      <div className={s.card}>
        {intro}
        {step.kind === "email" ? (
          <form key="email" className={s.form} onSubmit={onEmail} noValidate>
            {!intro && (
              <>
                <h1 className={s.title}>Вход в чат команды</h1>
                <p className={s.lead}>Пришлём шестизначный код на рабочую почту. Пароль не нужен.</p>
              </>
            )}
            {providers.data?.google && (
              <>
                <a
                  className={s.google}
                  href={googleHref}
                  onClick={(e) => {
                    // В приложении Google не пускает во встроенное окно: вход идёт в системном браузере.
                    if (!desktop) return;
                    e.preventDefault();
                    desktop.signInWithGoogle(invite?.token);
                    setError(null);
                    setDesktopWaiting(true);
                  }}
                >
                  <GoogleMark />
                  Войти через Google
                </a>
                {desktopWaiting && <p className={s.lead} role="status">Продолжите вход в открывшемся браузере, потом вернитесь сюда.</p>}
                <div className={s.or} role="separator">
                  <span>или по коду из письма</span>
                </div>
              </>
            )}
            <TextField
              label="Рабочая почта"
              type="email"
              autoComplete="email"
              autoFocus={!emailLocked}
              readOnly={emailLocked}
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error ?? undefined}
              hint={emailLocked ? "Приглашение отправлено на этот адрес" : undefined}
              icon={<Mail />}
            />
            <Button type="submit" size="l" loading={busy} disabled={!email.includes("@")}>
              Получить код
            </Button>
          </form>
        ) : (
          <form key="code" className={s.form} onSubmit={onCode} noValidate>
            <h1 className={s.title}>Проверьте почту</h1>
            <p className={s.lead}>
              Отправили код на <strong>{step.email}</strong>. Он действует 10 минут.
            </p>
            <TextField
              label="Код из письма"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              error={error ?? undefined}
              hint={resent ? "Отправили новый код" : undefined}
            />
            <Button type="submit" size="l" loading={busy} disabled={code.length !== 6}>
              Войти
            </Button>
            <div className={s.links}>
              <button
                type="button"
                className={s.link}
                onClick={() => {
                  setResent(true);
                  void requestCode(step.email);
                }}
                disabled={busy}
              >
                Отправить код ещё раз
              </button>
              {!emailLocked && (
                <button
                  type="button"
                  className={s.link}
                  onClick={() => {
                    setStep({ kind: "email" });
                    setError(null);
                    setResent(false);
                  }}
                >
                  Другой адрес
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

// Знак Google рисуем сами: четыре цветных сектора буквы G из официальных цветов.
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
