import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtGuard } from '../auth/jwt.guard';
import { zodBody } from '../common/zod-validation.pipe';
import {
  type ConfigurePrizesRequest,
  type CreateGameRequest,
  type GameResponse,
  type GameSummaryResponse,
  type UpdateGameRequest,
  configurePrizesSchema,
  createGameSchema,
  updateGameSchema,
} from './dto';
import { GameService } from './game.service';

@Controller('games')
@UseGuards(JwtGuard)
export class GameController {
  constructor(private readonly games: GameService) {}

  @Get()
  findAll(@CurrentUser() ownerId: string): Promise<GameSummaryResponse[]> {
    return this.games.findAll(ownerId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GameResponse> {
    return this.games.findOne(ownerId, id);
  }

  @Post()
  create(
    @CurrentUser() ownerId: string,
    @Body(zodBody(createGameSchema)) request: CreateGameRequest,
  ): Promise<GameResponse> {
    return this.games.create(ownerId, request);
  }

  @Patch(':id')
  update(
    @CurrentUser() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateGameSchema)) request: UpdateGameRequest,
  ): Promise<GameResponse> {
    return this.games.update(ownerId, id, request);
  }

  @Put(':id/prizes')
  configurePrizes(
    @CurrentUser() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(configurePrizesSchema)) request: ConfigurePrizesRequest,
  ): Promise<GameResponse> {
    return this.games.configurePrizes(ownerId, id, request);
  }

  @Post(':id/open')
  @HttpCode(HttpStatus.OK)
  open(
    @CurrentUser() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GameResponse> {
    return this.games.open(ownerId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() ownerId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.games.remove(ownerId, id);
  }
}
