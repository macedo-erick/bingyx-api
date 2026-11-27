import { randomInt } from 'node:crypto';

export const SIZE = 5;
export const BALLS_PER_COLUMN = 15;
export const BALL_COUNT = SIZE * BALLS_PER_COLUMN;
export const FREE = 0;

const CENTER = Math.floor((SIZE * SIZE) / 2);
const LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;

export type Letter = (typeof LETTERS)[number];
export type Random = (max: number) => number;

export class CardSpaceExhaustedError extends Error {}

export function letterOf(ball: number): Letter {
  const letter = LETTERS[Math.floor((ball - 1) / BALLS_PER_COLUMN)];

  if (letter === undefined) {
    throw new RangeError(`Not a ball: ${String(ball)}`);
  }

  return letter;
}

// Row-major 5x5. Each column draws from its own fifteen (B 1-15 … O 61-75) and reads top to
// bottom in ascending order, like a printed card; the free centre is FREE.
export function generateGrid(freeCenter: boolean, random: Random = randomInt): number[] {
  const columns = LETTERS.map((_, column) => {
    const free = freeCenter && column === CENTER % SIZE;
    const numbers = pick(column * BALLS_PER_COLUMN + 1, free ? SIZE - 1 : SIZE, random);

    if (free) {
      numbers.splice(Math.floor(SIZE / 2), 0, FREE);
    }

    return numbers;
  });

  return Array.from({ length: SIZE * SIZE }, (_, index) => {
    const value = columns[index % SIZE]?.[Math.floor(index / SIZE)];

    if (value === undefined) {
      throw new Error('Card column came out short');
    }

    return value;
  });
}

export function gridKey(grid: readonly number[]): string {
  return grid.join(',');
}

export function generateUniqueGrid(
  freeCenter: boolean,
  taken: ReadonlySet<string>,
  random: Random = randomInt,
  attempts = 50,
): number[] {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const grid = generateGrid(freeCenter, random);

    if (!taken.has(gridKey(grid))) {
      return grid;
    }
  }

  throw new CardSpaceExhaustedError(`No unused card found in ${String(attempts)} attempts`);
}

function pick(first: number, count: number, random: Random): number[] {
  const pool = Array.from({ length: BALLS_PER_COLUMN }, (_, offset) => first + offset);

  for (let i = 0; i < count; i++) {
    const j = i + random(pool.length - i);
    const swap = pool[j];

    pool[j] = pool[i] ?? 0;
    pool[i] = swap ?? 0;
  }

  return pool.slice(0, count).sort((a, b) => a - b);
}
