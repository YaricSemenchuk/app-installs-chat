// Файлы в сообщении: картинки миниатюрами (клик — полноэкранный просмотр), остальное карточками.
import { useState } from "react";
import { Download, FileX } from "lucide-react";
import type { FileDto } from "@teamchat/shared";
import { cx } from "../lib/cx";
import { fileKind, fileUrls, fitBox, formatBytes } from "./kind";
import { Lightbox } from "./Lightbox";
import s from "./Attachments.module.scss";

const SINGLE_MAX = 360;

export const isPreviewable = (f: FileDto) => !f.deleted && f.image !== null && f.image.thumbs.length > 0;

export function Attachments({ files, author, time }: { files: FileDto[]; author: string; time: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const images = files.filter(isPreviewable);
  const others = files.filter((f) => !isPreviewable(f));

  return (
    <div className={s.attachments}>
      {images.length === 1 && <SingleImage file={images[0]!} onOpen={() => setOpen(0)} />}
      {images.length > 1 && (
        <div className={s.grid}>
          {images.map((f, i) => (
            <button key={f.id} type="button" className={s.tile} onClick={() => setOpen(i)} aria-label={`Открыть ${f.name}`}>
              <img src={fileUrls(f.id).thumb(360)} srcSet={`${fileUrls(f.id).thumb(360)} 1x, ${fileUrls(f.id).thumb(720)} 2x`} alt={f.name} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {others.map((f) => (
        <FileTile key={f.id} file={f} />
      ))}
      {open !== null && <Lightbox images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} author={author} time={time} />}
    </div>
  );
}

function SingleImage({ file, onOpen }: { file: FileDto; onOpen: () => void }) {
  const box = fitBox(file.image!.width, file.image!.height, SINGLE_MAX);
  const urls = fileUrls(file.id);
  return (
    <button type="button" className={s.single} onClick={onOpen} aria-label={`Открыть ${file.name}`} style={{ width: box.width, height: box.height }}>
      <img src={urls.thumb(360)} srcSet={`${urls.thumb(360)} 1x, ${urls.thumb(720)} 2x`} alt={file.name} width={box.width} height={box.height} loading="lazy" />
    </button>
  );
}

export function FileTile({ file, compact = false }: { file: FileDto; compact?: boolean }) {
  if (file.deleted) {
    return (
      <div className={cx(s.file, s.fileDeleted)}>
        <span className={s.fileIcon}>
          <FileX />
        </span>
        <span className={s.fileText}>
          <span className={s.fileName}>{file.name}</span>
          <span className={s.fileMeta}>Файл удалён</span>
        </span>
      </div>
    );
  }
  const k = fileKind(file);
  const Icon = k.icon;
  return (
    <a className={cx(s.file, compact && s.fileCompact)} href={fileUrls(file.id).download} download={file.name} aria-label={`Скачать: ${file.name}`}>
      <span className={s.fileIcon} style={{ background: `var(--color-avatar-${k.tone})` }}>
        <Icon />
      </span>
      <span className={s.fileText}>
        <span className={s.fileName} title={file.name}>
          {file.name}
        </span>
        <span className={s.fileMeta}>
          {k.label} · {formatBytes(file.size)}
        </span>
      </span>
      <span className={s.fileDownload} aria-hidden>
        <Download />
      </span>
    </a>
  );
}
