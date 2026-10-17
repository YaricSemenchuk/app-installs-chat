// Вложения композера: каждое начинает грузиться сразу, как его добавили, — к отправке они уже готовы.
// Байты идут XHR-ом (у fetch нет прогресса загрузки) PUT-ом на адрес из POST /files.
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_FILE_BYTES, MAX_FILES_PER_MESSAGE, type FileDto, type UploadTicketDto } from "@teamchat/shared";
import { api } from "../api/http";
import { toast } from "../ui/Toaster";

export type Attachment = {
  key: string;
  name: string;
  size: number;
  type: string;
  preview: string | null; // object URL для картинок, пока нет миниатюры с сервера
  status: "uploading" | "ready" | "error" | "too-large";
  progress: number; // 0..1
  error?: string;
  file?: FileDto;
};

export function useUploads() {
  const [items, setItems] = useState<Attachment[]>([]);
  const current = useRef<Attachment[]>([]);
  current.current = items;
  const sources = useRef(new Map<string, File>());
  const xhrs = useRef(new Map<string, XMLHttpRequest>());

  const patch = useCallback((key: string, fn: (a: Attachment) => Attachment) => setItems((xs) => xs.map((a) => (a.key === key ? fn(a) : a))), []);

  const start = useCallback(
    async (key: string) => {
      const file = sources.current.get(key);
      if (!file) return;
      patch(key, (a) => ({ ...a, status: "uploading", progress: 0, error: undefined }));
      try {
        const ticket = await api<UploadTicketDto>("/files", { method: "POST", body: { name: file.name, size: file.size, mimetype: file.type } });
        const done = await putBytes<FileDto>(ticket.uploadUrl, file, (p) => patch(key, (a) => ({ ...a, progress: p })), (x) => xhrs.current.set(key, x));
        patch(key, (a) => ({ ...a, status: "ready", progress: 1, file: done }));
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        patch(key, (a) => ({ ...a, status: "error", error: (err as Error).message || "Не загрузилось" }));
      } finally {
        xhrs.current.delete(key);
      }
    },
    [patch],
  );

  // Побочные эффекты — снаружи апдейтеров состояния: в StrictMode те вызываются дважды.
  const add = useCallback(
    (files: File[]) => {
      const room = MAX_FILES_PER_MESSAGE - current.current.length;
      if (files.length > room) toast(`В одно сообщение — не больше ${MAX_FILES_PER_MESSAGE} файлов`, "error");
      const added = files.slice(0, Math.max(0, room)).map((f): Attachment => {
          const key = crypto.randomUUID();
          sources.current.set(key, f);
          const tooLarge = f.size > MAX_FILE_BYTES;
          return {
            key,
            name: f.name || "файл",
            size: f.size,
            type: f.type,
            preview: f.type.startsWith("image/") && !tooLarge ? URL.createObjectURL(f) : null,
            status: tooLarge ? "too-large" : "uploading",
            progress: 0,
          };
      });
      current.current = [...current.current, ...added];
      setItems((xs) => [...xs, ...added]);
      added.filter((a) => a.status === "uploading").forEach((a) => void start(a.key));
    },
    [start],
  );

  const remove = useCallback((key: string) => {
    xhrs.current.get(key)?.abort();
    sources.current.delete(key);
    const gone = current.current.find((a) => a.key === key);
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    setItems((xs) => xs.filter((a) => a.key !== key));
  }, []);

  // После отправки: превью больше не нужны, сами файлы уже в сообщении.
  const clear = useCallback(() => {
    current.current.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
    current.current = [];
    setItems([]);
    sources.current.clear();
  }, []);

  useEffect(
    () => () => {
      xhrs.current.forEach((x) => x.abort());
    },
    [],
  );

  return {
    items,
    add,
    remove,
    retry: (key: string) => void start(key),
    clear,
    busy: items.some((a) => a.status === "uploading"),
    ready: items.filter((a) => a.status === "ready" && a.file).map((a) => a.file!),
    broken: items.some((a) => a.status === "error" || a.status === "too-large"),
  };
}

export type Uploads = ReturnType<typeof useUploads>;

// Один файл без композера — например, фото профиля.
export async function uploadFile(file: File, onProgress: (p: number) => void = () => undefined): Promise<FileDto> {
  const ticket = await api<UploadTicketDto>("/files", { method: "POST", body: { name: file.name || "фото", size: file.size, mimetype: file.type } });
  return putBytes<FileDto>(ticket.uploadUrl, file, onProgress, () => undefined);
}

// PUT сырых байтов с прогрессом; ответ — JSON. Отмена — abort() у XHR из onStart.
export function putBytes<T>(url: string, file: Blob, onProgress: (p: number) => void, onStart: (x: XMLHttpRequest) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("Content-Type", "application/octet-stream");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(x.responseText);
      } catch {
        // ответ без тела
      }
      if (x.status >= 200 && x.status < 300) resolve(body as T);
      else reject(new Error((body as { message?: string } | null)?.message ?? "Не загрузилось"));
    };
    x.onerror = () => reject(new Error("Нет связи с сервером"));
    x.onabort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    onStart(x);
    x.send(file);
  });
}
