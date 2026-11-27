import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtGuard } from '../auth/jwt.guard';

export interface MeResponse {
  readonly id: string;
}

@Controller('me')
@UseGuards(JwtGuard)
export class MeController {
  @Get()
  me(@CurrentUser() sub: string): MeResponse {
    return { id: sub };
  }
}
