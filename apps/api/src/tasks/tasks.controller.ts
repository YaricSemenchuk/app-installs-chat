import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Put, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import {
  FigmaPreviewQuery,
  TaskSourceInput,
  type ChannelTasksDto,
  type FigmaPreviewDto,
  type IntegrationsDto,
  type JiraProjectDto,
  type MyTasksDto,
} from "@teamchat/shared";
import { CurrentUser, SessionGuard } from "../auth/session.guard.js";
import { toFigmaPreviewDto } from "../common/mappers.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { sendDelivery } from "../files/files.controller.js";
import type { users } from "../generated/prisma/client.js";
import { FigmaService } from "./figma.service.js";
import { TasksService } from "./tasks.service.js";

const Id = new ParseUUIDPipe();

@Controller()
@UseGuards(SessionGuard)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly figma: FigmaService,
  ) {}

  // Что подключено на сервере: от этого зависит, есть ли вкладка «Задачи» и «Мои задачи».
  @Get("integrations")
  integrations(): IntegrationsDto {
    return this.tasks.integrations();
  }

  @Get("conversations/:id/tasks")
  channel(@CurrentUser() me: users, @Param("id", Id) id: string): Promise<ChannelTasksDto> {
    return this.tasks.channel(me, id);
  }

  @Put("conversations/:id/tasks/source")
  setSource(@CurrentUser() me: users, @Param("id", Id) id: string, @Body(new ZodPipe(TaskSourceInput)) body: TaskSourceInput): Promise<ChannelTasksDto> {
    return this.tasks.setSource(me, id, body);
  }

  @Get("me/tasks")
  mine(@CurrentUser() me: users): Promise<MyTasksDto> {
    return this.tasks.mine(me);
  }

  @Get("jira/projects")
  projects(): Promise<JiraProjectDto[]> {
    return this.tasks.projects();
  }

  @Get("figma/preview")
  async preview(@Query(new ZodPipe(FigmaPreviewQuery)) q: FigmaPreviewQuery): Promise<FigmaPreviewDto> {
    return toFigmaPreviewDto(await this.tasks.preview(q.url));
  }

  @Get("figma/previews/:id/image")
  async image(@Param("id", Id) id: string, @Res() res: Response) {
    const d = await this.figma.image(id);
    if (!d) throw new NotFoundException("Картинки нет");
    sendDelivery(res, d);
  }
}
