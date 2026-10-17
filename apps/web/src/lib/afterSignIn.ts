// Куда вернуть человека после входа: страница, с которой его отправили на /signin (например, /download).
// sessionStorage, а не параметр адреса: вход через Google возвращает на «/», и параметр бы потерялся.
const KEY = "teamchat.afterSignIn";

export function rememberReturn(path: string): void {
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // без хранилища просто попадём на главную
  }
}

// Только читает: рендер в StrictMode идёт дважды, поэтому стираем отдельно, в эффекте.
// Только свои пути: «//host» браузер понял бы как чужой сайт.
export function pendingReturn(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    return path && path.startsWith("/") && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}

export function clearReturn(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // нечего стирать
  }
}
