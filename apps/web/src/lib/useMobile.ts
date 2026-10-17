// Телефонная ширина (та же граница, что в @mixin mobile): один экран за раз — список или разговор.
import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767px)";
const media = typeof window !== "undefined" ? window.matchMedia(QUERY) : null;

const subscribe = (cb: () => void) => {
  media?.addEventListener("change", cb);
  return () => media?.removeEventListener("change", cb);
};

export const isMobile = () => media?.matches ?? false;

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobile, () => false);
}
