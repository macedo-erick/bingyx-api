import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentPlayer, PlayerGuard } from '../auth/player.guard';
import type { PlayerIdentity } from '../auth/player-token.service';
import type { PlayerStateResponse } from './dto';
import { PlayerService } from './player.service';

@Controller('player')
@UseGuards(PlayerGuard)
export class PlayerController {
  constructor(private readonly players: PlayerService) {}

  @Get()
  state(@CurrentPlayer() player: PlayerIdentity): Promise<PlayerStateResponse> {
    return this.players.state(player);
  }
}
