import { randomInt } from 'node:crypto';

// No 0/O, 1/I/L: the code is read aloud and typed from a TV across the room.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const GAME_CODE_LENGTH = 6;

export function newGameCode(): string {
  let code = '';

  for (let i = 0; i < GAME_CODE_LENGTH; i++) {
    code += ALPHABET.charAt(randomInt(ALPHABET.length));
  }

  return code;
}
