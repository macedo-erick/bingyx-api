/* eslint-disable @typescript-eslint/consistent-type-definitions -- kept alongside the other response shapes. */
import { z } from 'zod';

import type { GameStatus, PrizeType } from '../database/schema';
import type { WinnerView } from './game-events';
import type { RankEntry } from './ranking';

export const ballSchema = z.coerce.number().int().min(1).max(75);

export type DrawResponse = {
  readonly seq: number;
  readonly ball: number;
  readonly letter: string;
};

export type ClaimResponse = {
  readonly valid: boolean;
  readonly prizeTypes: readonly PrizeType[];
};

export type PrizeProgress = {
  readonly type: PrizeType;
  readonly quantity: number;
  readonly description: string | null;
  readonly won: number;
};

export type LiveSnapshot = {
  readonly code: string;
  readonly name: string;
  readonly status: GameStatus;
  readonly scheduledAt: string | null;
  readonly registrationOpen: boolean;
  readonly participantCount: number;
  readonly draws: readonly number[];
  readonly prizes: readonly PrizeProgress[];
  readonly ranking: readonly RankEntry[];
  readonly winners: readonly WinnerView[];
  readonly window: {
    readonly closesAt: string;
    readonly claimants: readonly {
      readonly cardNumber: number;
      readonly name: string;
      readonly prizeType: PrizeType;
    }[];
  } | null;
};

export type ClaimLogEntry = {
  readonly cardNumber: number;
  readonly name: string;
  readonly prizeType: PrizeType | null;
  readonly valid: boolean;
  readonly atSeq: number;
  readonly at: string;
};

export type ControlView = LiveSnapshot & {
  readonly id: string;
  readonly claims: readonly ClaimLogEntry[];
};

export type PlayerView = {
  readonly live: LiveSnapshot;
  readonly me: {
    readonly rank: {
      readonly position: number;
      readonly missing: number;
      readonly prizeType: PrizeType;
    } | null;
    readonly wins: readonly PrizeType[];
    readonly pending: readonly PrizeType[];
  };
};
