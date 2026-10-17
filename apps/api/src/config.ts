import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url(),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET: минимум 16 символов"),
  BOOTSTRAP_OWNER_EMAIL: z.email().transform((v) => v.toLowerCase()),
  WORKSPACE_NAME: z.string().min(1).default("Team"),
  ALLOWED_EMAIL_DOMAINS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    ),
  RESEND_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  EMAIL_FROM: z.string().default("Team chat <chat@example.com>"),
  // Вход через Google включается, когда заданы оба значения. Redirect URI: {APP_URL}/api/auth/google/callback
  GOOGLE_CLIENT_ID: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  GOOGLE_CLIENT_SECRET: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  // Переопределяются только в e2e-тестах, чтобы не ходить в настоящий Google.
  GOOGLE_AUTH_URL: z.url().default("https://accounts.google.com/o/oauth2/v2/auth"),
  GOOGLE_TOKEN_URL: z.url().default("https://oauth2.googleapis.com/token"),
  // Звонки через LiveKit: адрес проекта (wss://<проект>.livekit.cloud) и ключ API. Без них звонки выключены.
  LIVEKIT_URL: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(z.url().optional()),
  LIVEKIT_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  LIVEKIT_API_SECRET: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  // Файлы: S3-совместимый бакет (Railway Buckets) или каталог на диске — для разработки и e2e.
  STORAGE_DRIVER: z.enum(["s3", "disk"]).default("disk"),
  STORAGE_DIR: z.string().default(".storage"),
  BUCKET_ENDPOINT: z.url().optional(),
  BUCKET_REGION: z.string().default("auto"),
  BUCKET_NAME: z.string().optional(),
  BUCKET_ACCESS_KEY_ID: z.string().optional(),
  BUCKET_SECRET_ACCESS_KEY: z.string().optional(),
  BUCKET_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Config = z.infer<typeof Env>;

function load(): Config {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) console.error(`env ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
  // Без почты сервер всё равно стартует: письма уходят в лог (см. MailService), чтобы владелец мог войти первым.
  if (parsed.data.NODE_ENV === "production" && !parsed.data.RESEND_API_KEY) {
    console.warn("env RESEND_API_KEY не задан: письма не отправляются, коды входа и приглашения пишутся в лог сервиса");
  }
  const livekit = [parsed.data.LIVEKIT_URL, parsed.data.LIVEKIT_API_KEY, parsed.data.LIVEKIT_API_SECRET].filter(Boolean).length;
  if (livekit !== 0 && livekit !== 3) {
    console.error("env LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET: для звонков нужны все три");
    process.exit(1);
  }
  // Диск контейнера на Railway стирается при каждом деплое: в production файлы только в бакете.
  if (parsed.data.NODE_ENV === "production" && parsed.data.STORAGE_DRIVER !== "s3") {
    console.error("env STORAGE_DRIVER: в production нужен s3 (Railway Bucket), диск контейнера не переживает деплой");
    process.exit(1);
  }
  if (parsed.data.STORAGE_DRIVER === "s3") {
    const missing = (["BUCKET_ENDPOINT", "BUCKET_NAME", "BUCKET_ACCESS_KEY_ID", "BUCKET_SECRET_ACCESS_KEY"] as const).filter(
      (k) => !parsed.data[k],
    );
    if (missing.length > 0) {
      console.error(`env ${missing.join(", ")}: нужны для STORAGE_DRIVER=s3`);
      process.exit(1);
    }
  }
  return parsed.data;
}

export const config = load();
export const isProd = config.NODE_ENV === "production";
export const appOrigin = new URL(config.APP_URL).origin;
