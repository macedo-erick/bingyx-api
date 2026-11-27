import { Global, Module } from '@nestjs/common';

import { JwtGuard } from './jwt.guard';
import { PlayerGuard } from './player.guard';
import { PlayerTokenService } from './player-token.service';

@Global()
@Module({
  providers: [JwtGuard, PlayerGuard, PlayerTokenService],
  exports: [JwtGuard, PlayerGuard, PlayerTokenService],
})
export class AuthModule {}
