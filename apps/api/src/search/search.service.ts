// Поиск по сообщениям на Postgres FTS: русская и английская морфология, «фраза» и -слово (websearch_to_tsquery),
// плюс имена приложенных файлов. Права — в том же SQL: участник разговора или открытый канал.
import { Injectable } from "@nestjs/common";
import type { SearchMessagesQuery, SearchPageDto } from "@teamchat/shared";
import { toMessageDto } from "../common/mappers.js";
import { MESSAGE_INCLUDE } from "../conversations/message-include.js";
import { PrismaService } from "../db/prisma.service.js";
import type { users } from "../generated/prisma/client.js";

const HL_START = "\u0001";
const HL_STOP = "\u0002";
// Опции ts_headline — одним параметром: подстановка внутри строкового литерала SQL не работает.
const HL_OPTIONS = `StartSel=${HL_START}, StopSel=${HL_STOP}, HighlightAll=true`;

type Hit = { id: string; seq: bigint; ru: string | null; en: string | null };

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async messages(me: users, q: SearchMessagesQuery): Promise<SearchPageDto> {
    const rows = await this.prisma.$queryRaw<Hit[]>`
      with q as (
        select websearch_to_tsquery('russian', ${q.q}) as ru,
               websearch_to_tsquery('english', ${q.q}) as en,
               websearch_to_tsquery('simple', ${q.q}) as fname
      )
      select m.id, m.seq,
             ts_headline('russian', regexp_replace(m.text, '<[^>]*>', ' ', 'g'), q.ru, ${HL_OPTIONS}) as ru,
             ts_headline('english', regexp_replace(m.text, '<[^>]*>', ' ', 'g'), q.en, ${HL_OPTIONS}) as en
        from messages m
        cross join q
        join conversations c on c.id = m.conversation_id
        left join conversation_members cm on cm.conversation_id = c.id and cm.user_id = ${me.id}::uuid
       where (cm.user_id is not null or c.kind = 'public')
         and m.deleted_at is null and m.subtype is null
         and (${q.conversationId ?? null}::uuid is null or m.conversation_id = ${q.conversationId ?? null}::uuid)
         and (${q.userId ?? null}::uuid is null or m.user_id = ${q.userId ?? null}::uuid)
         and (${q.before ?? null}::bigint is null or m.seq < ${q.before ?? null}::bigint)
         and (m.search_tsv @@ (q.ru || q.en)
              or exists (select 1 from message_files mf join files f on f.id = mf.file_id
                          where mf.message_id = m.id and f.deleted_at is null and f.search_tsv @@ q.fname))
       order by m.seq desc
       limit ${q.limit + 1}`;

    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const full = await this.prisma.messages.findMany({ where: { id: { in: page.map((r) => r.id) } }, include: MESSAGE_INCLUDE });
    const byId = new Map(full.map((m) => [m.id, m]));
    return {
      hits: page.flatMap((r) => {
        const m = byId.get(r.id);
        return m ? [{ message: toMessageDto(m), highlights: words(r.ru, r.en) }] : [];
      }),
      nextCursor: more ? Number(page.at(-1)!.seq) : null,
    };
  }
}

// Совпавшие слова из подсветки Postgres — клиент подсветит их в отрисованном сообщении.
function words(...headlines: (string | null)[]): string[] {
  const out = new Set<string>();
  const re = new RegExp(`${HL_START}([^${HL_STOP}]+)${HL_STOP}`, "g");
  for (const h of headlines) for (const m of (h ?? "").matchAll(re)) out.add(m[1]!.toLowerCase());
  return [...out].slice(0, 20);
}
