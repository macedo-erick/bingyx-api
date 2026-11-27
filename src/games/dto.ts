/* eslint-disable @typescript-eslint/consistent-type-definitions -- db.execute<T> needs the implicit index signature only a type alias has. */
import { z } from 'zod';

import { type GameStatus, PRIZE_TYPES, type PrizeType } from '../database/schema';

const name = z.string().trim().min(1).max(120);
const scheduledAt = z.iso.datetime({ offset: true }).nullable();
const claimWindowSeconds = z.number().int().min(3).max(60);

export const createGameSchema = z.object({
  name,
  scheduledAt: scheduledAt.optional(),
  freeCenter: z.boolean().optional(),
  claimWindowSeconds: claimWindowSeconds.optional(),
});
export type CreateGameRequest = z.infer<typeof createGameSchema>;

export const updateGameSchema = z
  .object({
    name: name.optional(),
    scheduledAt: scheduledAt.optional(),
    freeCenter: z.boolean().optional(),
    claimWindowSeconds: claimWindowSeconds.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    error: 'at least one field must be given',
  });
export type UpdateGameRequest = z.infer<typeof updateGameSchema>;

const prizeSchema = z.object({
  type: z.enum(PRIZE_TYPES),
  enabled: z.boolean(),
  quantity: z.number().int().min(1).max(20),
  description: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((value) => (value === '' || value === undefined ? null : value)),
});

export const configurePrizesSchema = z.object({
  prizes: z
    .array(prizeSchema)
    .length(PRIZE_TYPES.length)
    .refine((prizes) => new Set(prizes.map((prize) => prize.type)).size === PRIZE_TYPES.length, {
      error: 'every prize type must be given exactly once',
    })
    .refine((prizes) => prizes.some((prize) => prize.enabled), {
      error: 'at least one prize must be enabled',
    }),
});
export type ConfigurePrizesRequest = z.infer<typeof configurePrizesSchema>;

export type PrizeResponse = {
  readonly type: PrizeType;
  readonly enabled: boolean;
  readonly quantity: number;
  readonly description: string | null;
};

export type GameSummaryResponse = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: GameStatus;
  readonly scheduledAt: string | null;
  readonly registrationOpen: boolean;
  readonly createdAt: string;
  readonly participantCount: number;
  readonly drawnCount: number;
  readonly prizeCount: number;
  readonly winCount: number;
};

export type GameResponse = GameSummaryResponse & {
  readonly freeCenter: boolean;
  readonly claimWindowSeconds: number;
  readonly prizes: readonly PrizeResponse[];
};
