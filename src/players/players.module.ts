import { Module } from '@nestjs/common';

import { EngineModule } from '../engine/engine.module';
import { GamesModule } from '../games/games.module';
import { JoinController } from './join.controller';
import { PlayerController } from './player.controller';
import { PlayerRepository } from './player.repository';
import { PlayerService } from './player.service';
import { RosterController } from './roster.controller';

@Module({
  imports: [GamesModule, EngineModule],
  controllers: [JoinController, PlayerController, RosterController],
  providers: [PlayerService, PlayerRepository],
})
export class PlayersModule {}
