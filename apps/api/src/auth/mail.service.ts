import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { config, isProd } from "../config.js";

export type Mail = { to: string; subject: string; text: string };

@Injectable()
export class MailService {
  private readonly log = new Logger("Mail");

  async send(mail: Mail): Promise<void> {
    if (!config.RESEND_API_KEY) {
      if (isProd) {
        // Почта ещё не подключена: письмо видно только в логе сервиса (Railway → Logs), владелец берёт оттуда
        // код или ссылку-приглашение. Как только задан RESEND_API_KEY, письма уходят как обычно.
        this.log.warn(`почта не настроена, письмо не отправлено → ${mail.to}: ${mail.subject}\n${mail.text}`);
        return;
      }
      // Локально письма не уходят наружу: пишем их в .dev-mail.log (его читают и e2e-тесты).
      await appendFile(resolve(process.cwd(), ".dev-mail.log"), JSON.stringify({ at: new Date().toISOString(), ...mail }) + "\n");
      this.log.log(`→ ${mail.to}: ${mail.subject}`);
      return;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.EMAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}
