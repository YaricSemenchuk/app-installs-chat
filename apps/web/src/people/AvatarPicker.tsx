// Фото профиля: картинка видна сразу после выбора и грузится в фоне. Сохраняет родитель — вместе с остальным профилем.
import { useEffect, useRef, useState } from "react";
import { ImageUp } from "lucide-react";
import { MAX_FILE_BYTES } from "@teamchat/shared";
import { uploadFile } from "../files/uploads";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import s from "./AvatarPicker.module.scss";

// Сервер делает фото только из картинок, которые сам распознал, — те же форматы, что открываются в просмотре.
const TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

// undefined — фото не трогаем, null — убрать, строка — id загруженного файла для нового фото.
export type AvatarChoice = string | null | undefined;

export function AvatarPicker({
  name,
  id,
  current,
  onChange,
  onBusy,
}: {
  name: string;
  id: string;
  current: string | null;
  onChange: (v: AvatarChoice) => void;
  onBusy: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLButtonElement>(null);
  const attempt = useRef(0); // ответ старой загрузки не должен перебить более новый выбор
  const [preview, setPreview] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function settle(next: boolean) {
    setBusy(next);
    onBusy(next);
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!TYPES.includes(file.type)) return setError("Подойдёт картинка JPG, PNG, GIF или WebP");
    if (file.size > MAX_FILE_BYTES) return setError("Картинка больше 100 МБ");
    const n = ++attempt.current;
    setPreview(URL.createObjectURL(file));
    settle(true);
    try {
      const done = await uploadFile(file);
      if (n === attempt.current) onChange(done.id);
    } catch (err) {
      if (n !== attempt.current) return;
      setPreview(undefined);
      onChange(undefined);
      setError((err as Error).message || "Не загрузилось");
    } finally {
      if (n === attempt.current) settle(false);
    }
  }

  function remove() {
    attempt.current++;
    settle(false);
    setPreview(null);
    setError(null);
    onChange(null);
    upload.current?.focus(); // кнопка «Убрать» исчезла — фокус не должен пропасть
  }

  const shown = preview === undefined ? current : preview;
  return (
    <div className={s.picker}>
      <Avatar name={name} id={id} size="xl" src={shown} decorative />
      <div className={s.side}>
        <div className={s.actions}>
          <Button ref={upload} variant="secondary" size="s" icon={<ImageUp />} loading={busy} onClick={() => input.current?.click()}>
            {shown ? "Сменить фото" : "Загрузить фото"}
          </Button>
          {shown && (
            <Button variant="ghost" size="s" onClick={remove}>
              Убрать
            </Button>
          )}
        </div>
        <p className={error ? s.error : s.hint} role={error ? "alert" : undefined}>
          {error ?? "JPG, PNG, GIF или WebP — обрежем до квадрата"}
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept={TYPES.join(",")}
        hidden
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = ""; // тот же файл можно выбрать ещё раз
        }}
      />
    </div>
  );
}
