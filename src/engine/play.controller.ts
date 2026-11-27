import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { CurrentPlayer, PlayerGuard } from '../auth/player.guard';
import type { PlayerIdentity } from '../auth/player-token.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { gameCodeSchema } from '../players/dto';
import { ClaimService } from './claim.service';
import { type ClaimResponse, type LiveSnapshot, ballSchema } from './dto';
import { LiveService } from './live.service';
import { MarkService } from './mark.service';

const ballPipe = new ZodValidationPipe(ballSchema);

@Controller('player')
@UseGuards(PlayerGuard)
export class PlayController {
  constructor(
    private readonly marks: MarkService,
    private readonly claims: ClaimService,
  ) {}

  @Put('marks/:ball')
  mark(
    @CurrentPlayer() player: PlayerIdentity,
    @Param('ball', ballPipe) ball: number,
  ): Promise<number[]> {
    return this.marks.set(player, ball, true);
  }

  @Delete('marks/:ball')
  unmark(
    @CurrentPlayer() player: PlayerIdentity,
    @Param('ball', ballPipe) ball: number,
  ): Promise<number[]> {
    return this.marks.set(player, ball, false);
  }

  @Post('claims')
  @HttpCode(HttpStatus.OK)
  claim(@CurrentPlayer() player: PlayerIdentity): Promise<ClaimResponse> {
    return this.claims.claim(player);
  }
}

@Controller('public/games')
export class PublicController {
  constructor(private readonly live: LiveService) {}

  @Get(':code')
  snapshot(
    @Param('code', new ZodValidationPipe(gameCodeSchema)) code: string,
  ): Promise<LiveSnapshot> {
    return this.live.byCode(code);
  }
}
