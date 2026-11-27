/* eslint-disable @typescript-eslint/consistent-type-definitions -- db.execute<T> needs the implicit index signature only a type alias has. */
import { z } from 'zod';

import type { GameStatus, PrizeType } from '../database/schema';
import type { PlayerView } from '../engine/dto';

const personName = z.string().trim().min(1).max(60);

export const joinSchema = z.object({
  firstName: personName,
  lastName: personName,
});
export type JoinRequest = z.infer<typeof joinSchema>;

export const registrationSchema = z.object({
  open: z.boolean(),
});
export type RegistrationRequest = z.infer<typeof registrationSchema>;

export const gameCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{4,12}$/));

export type InvitationResponse = {
  readonly code: string;
  readonly name: string;
  readonly status: GameStatus;
  readonly scheduledAt: string | null;
  readonly registrationOpen: boolean;
  readonly prizes: readonly {
    readonly type: PrizeType;
    readonly quantity: number;
    readonly description: string | null;
  }[];
};

export interface SeatResponse {
  readonly playerToken: string;
  readonly cardNumber: number;
}

export type ParticipantResponse = {
  readonly cardNumber: number;
  readonly firstName: string;
  readonly lastName: string;
  readonly isOrganiser: boolean;
  readonly joinedAt: string;
};

export interface PlayerStateResponse extends PlayerView {
  readonly game: {
    readonly code: string;
    readonly name: string;
    readonly status: GameStatus;
    readonly scheduledAt: string | null;
  };
  readonly player: {
    readonly firstName: string;
    readonly lastName: string;
  };
  readonly card: {
    readonly number: number;
    readonly grid: readonly number[];
    readonly marked: readonly number[];
  };
}
