// Узкий мост для веб-клиента: window.desktop. Никакого доступа к Node и к произвольному IPC.
// Типы на стороне клиента — apps/web/src/desktop/bridge.ts.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type Link = { type: "open"; path: string } | { type: "auth"; code: string; verifier: string };

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  version: ipcRenderer.sendSync("desktop:version") as string,
  setBadge: (count: number) => ipcRenderer.send("desktop:badge", count),
  notify: (n: { title: string; body: string; path: string }) =>
    ipcRenderer.send("desktop:notify", { title: String(n.title), body: String(n.body), path: String(n.path) }),
  signInWithGoogle: (invite?: string) => ipcRenderer.send("desktop:google", invite ?? null),
  onLink: (cb: (link: Link) => void) => {
    const handler = (_e: IpcRendererEvent, link: Link) => cb(link);
    ipcRenderer.on("desktop:link", handler);
    return () => ipcRenderer.removeListener("desktop:link", handler);
  },
});
