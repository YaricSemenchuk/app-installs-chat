import { Injectable } from "@nestjs/common";
import type { EventDto, EventKind } from "@teamchat/shared";
import { toEventDto } from "../common/mappers.js";
import type { Tx } from "../db/prisma.service.js";

// Все записи журнала идут под одной транзакционной блокировкой: порядок events.id совпадает
// с порядком коммитов, и клиент, догружающий «всё после id N», ничего не пропустит.
const EVENTS_LOCK_KEY = 0x7465616d;

type Audience = { conversationId: string } | { userId: string } | { broadcast: true };

@Injectable()
export class EventsService {
  async lock(tx: Tx): Promise<void> {
    await tx.$executeRaw`select pg_advisory_xact_lock(${EVENTS_LOCK_KEY})`;
  }

  async append(tx: Tx, kind: EventKind, audience: Audience, payload: object): Promise<EventDto> {
    const row = await tx.events.create({
      data: {
        kind,
        conversation_id: "conversationId" in audience ? audience.conversationId : null,
        user_id: "userId" in audience ? audience.userId : null,
        broadcast: "broadcast" in audience,
        payload: payload as never,
      },
    });
    return toEventDto(row);
  }
}
