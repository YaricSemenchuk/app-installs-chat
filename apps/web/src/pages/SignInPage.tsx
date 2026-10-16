// S01 — вход по коду из письма.
import { useState, type SubmitEvent } from "react";
import { useNavigate } from "react-router";
import { Mail } from "lucide-react";
import type { UserDto } from "@teamchat/shared";
import { api, ApiError } from "../api/http";
import { bootKey, queryClient } from "../data/boot";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import s from "./SignInPage.module.scss";

type Step = { kind: "email" } | { kind: "code"; email: string };

export function SignInPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: "email" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function requestCode(address: string) {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/email/start", { method: "POST", body: { email: address } });
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

  return (
    <main className={s.page}>
      <div className={s.card}>
        {step.kind === "email" ? (
          <form className={s.form} onSubmit={onEmail} noValidate>
            <h1 className={s.title}>Вход в чат команды</h1>
            <p className={s.lead}>Пришлём шестизначный код на рабочую почту. Пароль не нужен.</p>
            <TextField
              label="Рабочая почта"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error ?? undefined}
              icon={<Mail />}
            />
            <Button type="submit" size="l" loading={busy} disabled={!email.includes("@")}>
              Получить код
            </Button>
          </form>
        ) : (
          <form className={s.form} onSubmit={onCode} noValidate>
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
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
