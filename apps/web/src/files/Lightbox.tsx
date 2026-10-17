// Полноэкранный просмотр картинок сообщения: оригинал по центру, ←→ между картинками, Esc закрывает.
import { useEffect } from "react";
import { Dialog as D } from "radix-ui";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import type { FileDto } from "@teamchat/shared";
import { IconButton } from "../ui/IconButton";
import { fileUrls, formatBytes } from "./kind";
import s from "./Lightbox.module.scss";

type Props = {
  images: FileDto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  author: string;
  time: string;
};

export function Lightbox({ images, index, onIndex, onClose, author, time }: Props) {
  const file = images[index]!;
  const many = images.length > 1;
  const go = (step: number) => onIndex((index + step + images.length) % images.length);

  useEffect(() => {
    if (!many) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <D.Root open onOpenChange={(v) => !v && onClose()}>
      <D.Portal>
        <D.Overlay className={s.overlay} />
        <D.Content
          className={s.content}
          aria-describedby={undefined}
          // Фокус — на сам просмотр, а не на «Закрыть»: иначе сразу всплывает его подсказка.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
        >
          <header className={s.header}>
            <div className={s.titles}>
              <D.Title className={s.title}>{file.name}</D.Title>
              <span className={s.caption}>
                {author} · {time} · {formatBytes(file.size)}
                {many && ` · ${index + 1} из ${images.length}`}
              </span>
            </div>
            <a className={s.download} href={fileUrls(file.id).download} download={file.name}>
              <Download />
              Скачать
            </a>
            <D.Close asChild>
              <IconButton label="Закрыть" shortcut="Esc" size="s">
                <X />
              </IconButton>
            </D.Close>
          </header>
          <div className={s.stage}>
            {many && (
              <button type="button" className={`${s.nav} ${s.prev}`} onClick={() => go(-1)} aria-label="Предыдущая картинка">
                <ChevronLeft />
              </button>
            )}
            <img key={file.id} className={s.image} src={fileUrls(file.id).inline} alt={file.name} width={file.image?.width} height={file.image?.height} />
            {many && (
              <button type="button" className={`${s.nav} ${s.next}`} onClick={() => go(1)} aria-label="Следующая картинка">
                <ChevronRight />
              </button>
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
