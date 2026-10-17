import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { CallJoinDto, CallsDto } from "@teamchat/shared";
import { CurrentUser, SessionGuard } from "../auth/session.guard.js";
import type { users } from "../generated/prisma/client.js";
import { CallsService } from "./calls.service.js";

const Id = new ParseUUIDPipe();

@Controller()
@UseGuards(SessionGuard)
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Get("calls")
  list(@CurrentUser() me: users): Promise<CallsDto> {
    return this.calls.list(me);
  }

  // Начать звонок или присоединиться к идущему; тело пустое ({}), ответ — адрес LiveKit и токен.
  @Post("conversations/:id/call")
  @HttpCode(200)
  join(@CurrentUser() me: users, @Param("id", Id) id: string, @Body() _body: unknown): Promise<CallJoinDto> {
    return this.calls.join(me, id);
  }

  @Post("calls/:id/leave")
  @HttpCode(204)
  leave(@CurrentUser() me: users, @Param("id", Id) id: string): Promise<void> {
    return this.calls.leave(me, id);
  }

  @Post("calls/:id/decline")
  @HttpCode(204)
  decline(@CurrentUser() me: users, @Param("id", Id) id: string): Promise<void> {
    return this.calls.decline(me, id);
  }
}

// Вебхуки LiveKit: без сессии, проверяются подписью (JWT с хэшем тела) ключом API.
@Controller("livekit")
export class LivekitWebhookController {
  constructor(private readonly calls: CallsService) {}

  @Post("webhook")
  @HttpCode(200)
  async webhook(@Req() req: Request): Promise<{ ok: true }> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > 64 * 1024) break; // события LiveKit маленькие; больше — не от него
      chunks.push(chunk);
    }
    await this.calls.webhook(Buffer.concat(chunks).toString("utf8"), req.headers.authorization);
    return { ok: true };
  }
}
