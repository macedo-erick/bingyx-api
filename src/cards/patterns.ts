import type { PrizeType } from '../database/schema';
import { FREE, SIZE } from './card-grid';

const INDEXES = [0, 1, 2, 3, 4];

const ROWS = INDEXES.map((row) => INDEXES.map((column) => row * SIZE + column));
const COLUMNS = INDEXES.map((column) => INDEXES.map((row) => row * SIZE + column));
const DIAGONALS = [INDEXES.map((i) => i * SIZE + i), INDEXES.map((i) => i * SIZE + (SIZE - 1 - i))];
const FULL = [Array.from({ length: SIZE * SIZE }, (_, index) => index)];

export const PATTERNS: Record<PrizeType, readonly (readonly number[])[]> = {
  line: ROWS,
  column: COLUMNS,
  diagonal: DIAGONALS,
  full: FULL,
};

// The fewest balls still needed to close any one pattern of this prize on the card.
export function missingFor(
  grid: readonly number[],
  drawn: ReadonlySet<number>,
  type: PrizeType,
): number {
  return Math.min(
    ...PATTERNS[type].map(
      (cells) =>
        cells.filter((index) => {
          const value = grid[index] ?? FREE;

          return value !== FREE && !drawn.has(value);
        }).length,
    ),
  );
}

export function completes(
  grid: readonly number[],
  drawn: ReadonlySet<number>,
  type: PrizeType,
): boolean {
  return missingFor(grid, drawn, type) === 0;
}
