import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/jwt.guard';
import { type PlayerIdentity, PlayerTokenService } from '../auth/player-token.service';
import { DATABASE, type Database } from '../database/db';
import type { GameStatus } from '../database/schema';
import { GameEvents } from '../engine/game-events';
import { LiveService } from '../engine/live.service';
import { GameRepository } from '../games/game.repository';
import type {
  InvitationResponse,
  JoinRequest,
  ParticipantResponse,
  PlayerStateResponse,
  SeatResponse,
} from './dto';
import { PlayerRepository } from './player.repository';

// Late arrivals may still join a draw in progress, for as long as the organiser leaves the door open.
const JOINABLE: readonly GameStatus[] = ['open', 'running', 'checking'];

@Injectable()
export class PlayerService {
  private readonly logger = new Logger(PlayerService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly players: PlayerRepository,
    private readonly games: GameRepository,
    private readonly tokens: PlayerTokenService,
    private readonly live: LiveService,
    private readonly events: GameEvents,
  ) {}

  async invitation(code: string): Promise<InvitationResponse> {
    const found = await this.players.findInvitation(code);

    if (found === undefined) {
      throw new NotFoundException(`Game not found: ${code}`);
    }

    return found;
  }

  async join(code: string, request: JoinRequest): Promise<SeatResponse> {
    const { gameId, seat } = await this.db.transaction(async (tx) => {
      const locked = await this.players.lockByCode(tx, code);

      if (locked === undefined) {
        throw new NotFoundException(`Game not found: ${code}`);
      }

      if (!locked.registrationOpen || !JOINABLE.includes(locked.status)) {
        throw new ConflictException('Registration for this game is closed');
      }

      return {
        gameId: locked.id,
        seat: await this.players.seat(tx, locked, { ...request, ownerId: null }),
      };
    });

    this.logger.log({
      event: 'participant.joined',
      gameId,
      participantId: seat.participantId,
      cardNumber: seat.cardNumber,
    });
    this.events.emit({ kind: 'joined', gameId });

    return this.issue(gameId, seat.participantId, seat.cardNumber);
  }

  async playAsOrganiser(owner: AuthenticatedUser, gameId: string): Promise<SeatResponse> {
    const { seat, isNew } = await this.db.transaction(async (tx) => {
      const locked = await this.players.lockOwned(tx, owner.sub, gameId);

      if (locked === undefined) {
        throw new NotFoundException(`Game not found: ${gameId}`);
      }

      const existing = await this.players.findOwnerSeat(tx, gameId, owner.sub);

      if (existing !== undefined) {
        return { seat: existing, isNew: false };
      }

      if (locked.status === 'finished') {
        throw new ConflictException('The game has finished');
      }

      return {
        seat: await this.players.seat(tx, locked, {
          firstName: owner.givenName.slice(0, 60) || 'Organizador',
          lastName: owner.familyName.slice(0, 60),
          ownerId: owner.sub,
        }),
        isNew: true,
      };
    });

    if (isNew) {
      this.logger.log({
        event: 'participant.joined',
        gameId,
        participantId: seat.participantId,
        cardNumber: seat.cardNumber,
        organiser: true,
      });
      this.events.emit({ kind: 'joined', gameId });
    }

    return this.issue(gameId, seat.participantId, seat.cardNumber);
  }

  async setRegistration(ownerId: string, gameId: string, open: boolean): Promise<void> {
    const status = await this.games.findStatus(ownerId, gameId);

    if (status === undefined) {
      throw new NotFoundException(`Game not found: ${gameId}`);
    }

    if (!JOINABLE.includes(status)) {
      throw new ConflictException('Registration can only change while the game is open or live');
    }

    await this.players.setRegistration(gameId, open);
    this.logger.log({ event: 'game.updated', gameId, fields: ['registrationOpen'], open });
  }

  async participants(ownerId: string, gameId: string): Promise<ParticipantResponse[]> {
    if ((await this.games.findStatus(ownerId, gameId)) === undefined) {
      throw new NotFoundException(`Game not found: ${gameId}`);
    }

    return this.players.findParticipants(gameId);
  }

  async state(player: PlayerIdentity): Promise<PlayerStateResponse> {
    const found = await this.players.findPlayerState(player.participantId, player.gameId);

    if (found === undefined) {
      throw new NotFoundException('Player not found');
    }

    return { ...found, ...(await this.live.forPlayer(player.gameId, player.participantId)) };
  }

  private async issue(
    gameId: string,
    participantId: string,
    cardNumber: number,
  ): Promise<SeatResponse> {
    return {
      playerToken: await this.tokens.sign({ participantId, gameId }),
      cardNumber,
    };
  }
}
