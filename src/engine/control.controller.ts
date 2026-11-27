import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtGuard } from '../auth/jwt.guard';
import type { ControlView, DrawResponse } from './dto';
import { DrawService } from './draw.service';
import { LiveService } from './live.service';

@Controller('games/:id')
@UseGuards(JwtGuard)
export class ControlController {
  constructor(
    private readonly draws: DrawService,
    private readonly live: LiveService,
  ) {}

  @Get('live')
  view(
    @CurrentUser() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ControlView> {
    return this.live.forOwner(ownerId, id);
  }

  @Post('start')
  @HttpCode(HttpStatus.NO_CONTENT)
  start(@CurrentUser() ownerId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.draws.start(ownerId, id);
  }

  @Post('draw')
  @HttpCode(HttpStatus.CREATED)
  draw(
    @CurrentUser() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DrawResponse> {
    return this.draws.draw(ownerId, id);
  }

  @Post('finish')
  @HttpCode(HttpStatus.NO_CONTENT)
  finish(@CurrentUser() ownerId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.draws.finish(ownerId, id);
  }
}
