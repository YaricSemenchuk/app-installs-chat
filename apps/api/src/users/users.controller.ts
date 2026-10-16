import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { OnboardingInput, ProfileInput, RoleChangeInput, type AdminUserDto, type UserDto } from "@teamchat/shared";
import { CurrentUser, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import type { users } from "../generated/prisma/client.js";
import { UsersService } from "./users.service.js";

@Controller()
@UseGuards(SessionGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post("me/onboarding")
  onboard(@CurrentUser() me: users, @Body(new ZodPipe(OnboardingInput)) body: OnboardingInput): Promise<UserDto> {
    return this.users.onboard(me, body);
  }

  @Patch("me/profile")
  profile(@CurrentUser() me: users, @Body(new ZodPipe(ProfileInput)) body: ProfileInput): Promise<UserDto> {
    return this.users.updateProfile(me, body);
  }

  @Get("admin/users")
  list(@CurrentUser() me: users): Promise<AdminUserDto[]> {
    return this.users.listForAdmin(me);
  }

  @Patch("admin/users/:id")
  role(
    @CurrentUser() me: users,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(RoleChangeInput)) body: RoleChangeInput,
  ): Promise<UserDto> {
    return this.users.changeRole(me, id, body.role);
  }

  @Post("admin/users/:id/deactivate")
  deactivate(@CurrentUser() me: users, @Param("id", new ParseUUIDPipe()) id: string): Promise<UserDto> {
    return this.users.deactivate(me, id);
  }

  @Post("admin/users/:id/reactivate")
  reactivate(@CurrentUser() me: users, @Param("id", new ParseUUIDPipe()) id: string): Promise<UserDto> {
    return this.users.reactivate(me, id);
  }
}
