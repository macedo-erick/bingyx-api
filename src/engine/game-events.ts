import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import type { GameStatus, PrizeType } from '../database/schema';

export interface WinnerView {
  readonly prizeType: PrizeType;
  readonly description: string | null;
  readonly cardNumber: number;
  readonly name: string;
  readonly tieBreak: boolean;
  readonly atSeq: number;
}

export type GameEvent =
  | { readonly kind: 'status'; readonly gameId: string; readonly status: GameStatus }
  | { readonly kind: 'ball'; readonly gameId: string; readonly seq: number; readonly ball: number }
  | { readonly kind: 'window-opened'; readonly gameId: string; readonly closesAt: string }
  | {
      readonly kind: 'window-closed';
      readonly gameId: string;
      readonly winners: readonly WinnerView[];
      readonly tieBreakAmong: readonly { prizeType: PrizeType; cardNumbers: number[] }[];
    }
  | {
      readonly kind: 'claim';
      readonly gameId: string;
      readonly participantId: string;
      readonly valid: boolean;
    }
  | { readonly kind: 'marks'; readonly gameId: string; readonly participantId: string }
  | { readonly kind: 'joined'; readonly gameId: string };

// Emitted only after the change it describes has committed; the realtime gateway listens here.
@Injectable()
export class GameEvents {
  private readonly subject = new Subject<GameEvent>();

  readonly events$: Observable<GameEvent> = this.subject.asObservable();

  emit(event: GameEvent): void {
    this.subject.next(event);
  }
}
