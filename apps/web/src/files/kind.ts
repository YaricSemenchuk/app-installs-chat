// Вид файла для иконки и подписи: по типу из браузера, а если он пустой — по расширению.
import { File as FileIcon, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, Presentation } from "lucide-react";
import type { FileDto } from "@teamchat/shared";

export type FileKind = { label: string; icon: typeof FileIcon; tone: 1 | 2 | 3 | 4 | 5 | 6 };

const BY_EXT: Record<string, FileKind> = {};
const kind = (label: string, icon: typeof FileIcon, tone: FileKind["tone"], exts: string[]) => {
  const k = { label, icon, tone };
  exts.forEach((e) => (BY_EXT[e] = k));
  return k;
};
const PDF = kind("PDF", FileText, 5, ["pdf"]);
kind("Документ", FileText, 1, ["doc", "docx", "odt", "rtf", "pages"]);
kind("Таблица", FileSpreadsheet, 3, ["xls", "xlsx", "ods", "csv", "numbers"]);
kind("Презентация", Presentation, 4, ["ppt", "pptx", "odp", "key"]);
kind("Архив", FileArchive, 6, ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"]);
const VIDEO = kind("Видео", FileVideo, 2, ["mp4", "mov", "webm", "mkv", "avi", "m4v"]);
const AUDIO = kind("Аудио", FileAudio, 2, ["mp3", "wav", "m4a", "ogg", "flac", "aac"]);
kind("Код", FileCode, 1, ["js", "ts", "tsx", "jsx", "json", "py", "kt", "swift", "java", "go", "rs", "sql", "sh", "yml", "yaml", "xml", "html", "css", "scss"]);
const TEXT = kind("Текст", FileText, 1, ["txt", "md", "log"]);
const IMAGE = kind("Изображение", FileImage, 4, ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "svg", "tif", "tiff", "bmp", "psd", "fig", "sketch"]);
const OTHER: FileKind = { label: "Файл", icon: FileIcon, tone: 6 };

export function fileKind(f: Pick<FileDto, "name" | "mimetype">): FileKind {
  const ext = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "";
  if (BY_EXT[ext]) return BY_EXT[ext]!;
  const m = f.mimetype;
  if (m === "application/pdf") return PDF;
  if (m.startsWith("image/")) return IMAGE;
  if (m.startsWith("video/")) return VIDEO;
  if (m.startsWith("audio/")) return AUDIO;
  if (m.startsWith("text/")) return TEXT;
  return OTHER;
}

const units = ["Б", "КБ", "МБ", "ГБ"];
const number = new Intl.NumberFormat("ru", { maximumFractionDigits: 1 });

export function formatBytes(n: number): string {
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${number.format(u === 0 ? v : Math.round(v * 10) / 10)} ${units[u]}`;
}

export const fileUrls = (id: string) => ({
  download: `/api/files/${id}/download`,
  inline: `/api/files/${id}/download?inline=1`,
  thumb: (size: number) => `/api/files/${id}/thumb/${size}`,
});

// Вписать картинку в рамку, не растягивая маленькие.
export function fitBox(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
