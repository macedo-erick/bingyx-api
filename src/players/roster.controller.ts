import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser, CurrentUserProfile } from '../auth/current-user.decorator';
import { type AuthenticatedUser, JwtGuard } from '../auth/jwt.guard';
import { zodBody } from '../common/zod-validation.pipe';
import {
  type ParticipantResponse,
  type RegistrationRequest,
  type SeatResponse,
  registrationSchema,
} from './dto';
import { PlayerService } from './player.service';

@Controller('games/:id')
@UseGuards(JwtGuard)
export class RosterController {
  constructor(private readonly players: PlayerService) {}

  @Get('participants')
  participants(
    @CurrentUser() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ParticipantResponse[]> {
    return this.players.participants(ownerId, id);
  }

  @Patch('registration')
  @HttpCode(HttpStatus.NO_CONTENT)
  registration(
    @CurrentUser() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(registrationSchema)) request: RegistrationRequest,
  ): Promise<void> {
    return this.players.setRegistration(ownerId, id, request.open);
  }

  @Post('play')
  @HttpCode(HttpStatus.OK)
  play(
    @CurrentUserProfile() owner: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SeatResponse> {
    return this.players.playAsOrganiser(owner, id);
  }
}
