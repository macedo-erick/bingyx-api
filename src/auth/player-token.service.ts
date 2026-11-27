import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';

import { CONFIG, type Config } from '../config';

const ISSUER = 'bingyx-api';
const AUDIENCE = 'bingyx-player';

export interface PlayerIdentity {
  readonly participantId: string;
  readonly gameId: string;
}

export class InvalidPlayerTokenError extends Error {}

@Injectable()
export class PlayerTokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.key = new TextEncoder().encode(config.PLAYER_TOKEN_SECRET);
  }

  sign(identity: PlayerIdentity): Promise<string> {
    return new SignJWT({ gid: identity.gameId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(identity.participantId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(this.config.PLAYER_TOKEN_TTL)
      .sign(this.key);
  }

  async verify(token: string): Promise<PlayerIdentity> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      const gameId = payload['gid'];

      if (typeof payload.sub !== 'string' || typeof gameId !== 'string') {
        throw new InvalidPlayerTokenError('Token names no player');
      }

      return { participantId: payload.sub, gameId };
    } catch (error) {
      if (error instanceof InvalidPlayerTokenError) {
        throw error;
      }

      throw new InvalidPlayerTokenError(error instanceof Error ? error.message : String(error));
    }
  }
}
