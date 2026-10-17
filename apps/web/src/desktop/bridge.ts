// Мост к десктоп-оболочке (apps/desktop/src/preload.ts). В браузере его нет — всё работает и без него.
export type DesktopLink = { type: "open"; path: string } | { type: "auth"; code: string; verifier: string };

export type DesktopBridge = {
  platform: "darwin" | "win32" | "linux";
  version: string;
  setBadge(count: number): void;
  notify(n: { title: string; body: string; path: string }): void;
  // Вход через Google в системном браузере: verifier хранит оболочка, сюда вернётся ссылка auth.
  signInWithGoogle(invite?: string): void;
  onLink(cb: (link: DesktopLink) => void): () => void;
};

export const desktop: DesktopBridge | undefined = (window as unknown as { desktop?: DesktopBridge }).desktop;

// Новее ли версия a, чем b (1.10.0 > 1.9.3).
export function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}
