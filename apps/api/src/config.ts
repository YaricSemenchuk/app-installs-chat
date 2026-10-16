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
});

export type Config = z.infer<typeof Env>;

function load(): Config {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) console.error(`env ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
  if (parsed.data.NODE_ENV === "production" && !parsed.data.RESEND_API_KEY) {
    console.error("env RESEND_API_KEY: обязателен в production, иначе коды входа не дойдут");
    process.exit(1);
  }
  return parsed.data;
}

export const config = load();
export const isProd = config.NODE_ENV === "production";
export const appOrigin = new URL(config.APP_URL).origin;
