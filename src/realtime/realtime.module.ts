import { Module } from '@nestjs/common';

import { EngineModule } from '../engine/engine.module';
import { GameGateway } from './game.gateway';

@Module({
  imports: [EngineModule],
  providers: [GameGateway],
})
export class RealtimeModule {}
