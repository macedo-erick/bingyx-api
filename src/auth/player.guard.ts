import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';

import { bearerToken } from './bearer';
import {
  InvalidPlayerTokenError,
  type PlayerIdentity,
  PlayerTokenService,
} from './player-token.service';

declare module 'express' {
  interface Request {
    player?: PlayerIdentity;
  }
}

@Injectable()
export class PlayerGuard implements CanActivate {
  constructor(private readonly tokens: PlayerTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request.headers.authorization);

    if (token === null) {
      throw new UnauthorizedException('Missing player token');
    }

    try {
      request.player = await this.tokens.verify(token);

      return true;
    } catch (error) {
      if (error instanceof InvalidPlayerTokenError) {
        throw new UnauthorizedException('Invalid player token');
      }

      throw error;
    }
  }
}

export const CurrentPlayer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PlayerIdentity => {
    const player = context.switchToHttp().getRequest<Request>().player;

    if (player === undefined) {
      throw new UnauthorizedException();
    }

    return player;
  },
);
