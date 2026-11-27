import { Module } from '@nestjs/common';

import { ClaimService } from './claim.service';
import { ControlController } from './control.controller';
import { DrawService } from './draw.service';
import { EngineRepository } from './engine.repository';
import { GameEvents } from './game-events';
import { LiveService } from './live.service';
import { MarkService } from './mark.service';
import { PlayController, PublicController } from './play.controller';

@Module({
  controllers: [ControlController, PlayController, PublicController],
  providers: [ClaimService, DrawService, EngineRepository, GameEvents, LiveService, MarkService],
  exports: [GameEvents, LiveService],
})
export class EngineModule {}
