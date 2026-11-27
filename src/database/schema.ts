import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  smallint,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const GAME_STATUSES = ['draft', 'open', 'running', 'checking', 'finished'] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const PRIZE_TYPES = ['line', 'column', 'diagonal', 'full'] as const;
export type PrizeType = (typeof PRIZE_TYPES)[number];

export const game = pgTable(
  'game',
  {
    id: uuid('id').primaryKey(),
    code: varchar('code', { length: 12 }).notNull().unique(),
    ownerId: uuid('owner_id').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    status: varchar('status', { length: 10 }).$type<GameStatus>().notNull().default('draft'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    freeCenter: boolean('free_center').notNull().default(true),
    cardsPerPlayer: smallint('cards_per_player').notNull().default(1),
    claimWindowSeconds: smallint('claim_window_seconds').notNull().default(10),
    registrationOpen: boolean('registration_open').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_game_owner').on(table.ownerId, table.createdAt.desc()),
    check(
      'game_status_check',
      sql`${table.status} IN ('draft', 'open', 'running', 'checking', 'finished')`,
    ),
    check('game_cards_per_player_check', sql`${table.cardsPerPlayer} BETWEEN 1 AND 6`),
    check('game_claim_window_check', sql`${table.claimWindowSeconds} BETWEEN 3 AND 60`),
  ],
);

export const prizeRule = pgTable(
  'prize_rule',
  {
    id: uuid('id').primaryKey(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 10 }).$type<PrizeType>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    quantity: smallint('quantity').notNull().default(1),
    description: varchar('description', { length: 120 }),
    sortOrder: smallint('sort_order').notNull(),
  },
  (table) => [
    unique('uq_prize_rule_game_type').on(table.gameId, table.type),
    check('prize_rule_type_check', sql`${table.type} IN ('line', 'column', 'diagonal', 'full')`),
    check('prize_rule_quantity_check', sql`${table.quantity} BETWEEN 1 AND 20`),
  ],
);

export const invitation = pgTable(
  'invitation',
  {
    id: uuid('id').primaryKey(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 320 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('uq_invitation_game_email').on(table.gameId, table.email)],
);

export const participant = pgTable(
  'participant',
  {
    id: uuid('id').primaryKey(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    firstName: varchar('first_name', { length: 60 }).notNull(),
    lastName: varchar('last_name', { length: 60 }).notNull(),
    // Set when a Keycloak user, the organiser, takes a card in their own game.
    ownerId: uuid('owner_id'),
    invitationId: uuid('invitation_id').references(() => invitation.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_participant_game').on(table.gameId, table.createdAt),
    uniqueIndex('uq_participant_game_owner')
      .on(table.gameId, table.ownerId)
      .where(sql`owner_id IS NOT NULL`),
  ],
);

export const card = pgTable(
  'card',
  {
    id: uuid('id').primaryKey(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participant.id, { onDelete: 'cascade' }),
    number: smallint('number').notNull(),
    // Row-major 5x5; 0 is the free centre.
    grid: smallint('grid').array().notNull(),
    marked: smallint('marked')
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uq_card_game_number').on(table.gameId, table.number),
    index('idx_card_participant').on(table.participantId),
    check('card_grid_size_check', sql`cardinality(${table.grid}) = 25`),
  ],
);

export const draw = pgTable(
  'draw',
  {
    id: uuid('id').primaryKey(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    seq: smallint('seq').notNull(),
    ball: smallint('ball').notNull(),
    drawnAt: timestamp('drawn_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uq_draw_game_seq').on(table.gameId, table.seq),
    unique('uq_draw_game_ball').on(table.gameId, table.ball),
    check('draw_ball_check', sql`${table.ball} BETWEEN 1 AND 75`),
    check('draw_seq_check', sql`${table.seq} BETWEEN 1 AND 75`),
  ],
);

export const claimWindow = pgTable(
  'claim_window',
  {
    id: uuid('id').primaryKey(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    openedAtSeq: smallint('opened_at_seq').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closesAt: timestamp('closes_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    // At most one window open per game at a time.
    uniqueIndex('uq_claim_window_open')
      .on(table.gameId)
      .where(sql`closed_at IS NULL`),
  ],
);

export const claim = pgTable(
  'claim',
  {
    id: uuid('id').primaryKey(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => card.id, { onDelete: 'cascade' }),
    windowId: uuid('window_id').references(() => claimWindow.id, { onDelete: 'set null' }),
    prizeType: varchar('prize_type', { length: 10 }).$type<PrizeType>(),
    valid: boolean('valid').notNull(),
    atSeq: smallint('at_seq').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_claim_window').on(table.windowId),
    check(
      'claim_prize_type_check',
      sql`${table.prizeType} IS NULL OR ${table.prizeType} IN ('line', 'column', 'diagonal', 'full')`,
    ),
  ],
);

export const win = pgTable(
  'win',
  {
    id: uuid('id').primaryKey(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    prizeRuleId: uuid('prize_rule_id')
      .notNull()
      .references(() => prizeRule.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => card.id, { onDelete: 'cascade' }),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claim.id, { onDelete: 'cascade' }),
    tieBreak: boolean('tie_break').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uq_win_card_prize').on(table.cardId, table.prizeRuleId),
    index('idx_win_game').on(table.gameId, table.createdAt),
  ],
);

export type GameRow = typeof game.$inferSelect;
export type PrizeRuleRow = typeof prizeRule.$inferSelect;
export type InvitationRow = typeof invitation.$inferSelect;
export type ParticipantRow = typeof participant.$inferSelect;
export type CardRow = typeof card.$inferSelect;
export type DrawRow = typeof draw.$inferSelect;
export type ClaimWindowRow = typeof claimWindow.$inferSelect;
export type ClaimRow = typeof claim.$inferSelect;
export type WinRow = typeof win.$inferSelect;
