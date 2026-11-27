import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { ZodValidationPipe, zodBody } from '../common/zod-validation.pipe';
import {
  type InvitationResponse,
  type JoinRequest,
  type SeatResponse,
  gameCodeSchema,
  joinSchema,
} from './dto';
import { PlayerService } from './player.service';

const codePipe = new ZodValidationPipe(gameCodeSchema);

@Controller('join')
export class JoinController {
  constructor(private readonly players: PlayerService) {}

  @Get(':code')
  invitation(@Param('code', codePipe) code: string): Promise<InvitationResponse> {
    return this.players.invitation(code);
  }

  @Post(':code')
  join(
    @Param('code', codePipe) code: string,
    @Body(zodBody(joinSchema)) request: JoinRequest,
  ): Promise<SeatResponse> {
    return this.players.join(code, request);
  }
}
