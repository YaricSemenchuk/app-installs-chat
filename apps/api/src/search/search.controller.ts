import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { SearchMessagesQuery, type SearchPageDto } from "@teamchat/shared";
import { CurrentUser, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import type { users } from "../generated/prisma/client.js";
import { SearchService } from "./search.service.js";

@Controller("search")
@UseGuards(SessionGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get("messages")
  messages(@CurrentUser() me: users, @Query(new ZodPipe(SearchMessagesQuery)) q: SearchMessagesQuery): Promise<SearchPageDto> {
    return this.search.messages(me, q);
  }
}
