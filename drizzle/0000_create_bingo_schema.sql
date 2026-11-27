CREATE TABLE "card" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"number" smallint NOT NULL,
	"grid" smallint[] NOT NULL,
	"marked" smallint[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_card_game_number" UNIQUE("game_id","number"),
	CONSTRAINT "card_grid_size_check" CHECK (cardinality("card"."grid") = 25)
);
--> statement-breakpoint
CREATE TABLE "claim" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"window_id" uuid,
	"prize_type" varchar(10),
	"valid" boolean NOT NULL,
	"at_seq" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_prize_type_check" CHECK ("claim"."prize_type" IS NULL OR "claim"."prize_type" IN ('line', 'column', 'diagonal', 'full'))
);
--> statement-breakpoint
CREATE TABLE "claim_window" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"opened_at_seq" smallint NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "draw" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"ball" smallint NOT NULL,
	"drawn_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_draw_game_seq" UNIQUE("game_id","seq"),
	CONSTRAINT "uq_draw_game_ball" UNIQUE("game_id","ball"),
	CONSTRAINT "draw_ball_check" CHECK ("draw"."ball" BETWEEN 1 AND 75),
	CONSTRAINT "draw_seq_check" CHECK ("draw"."seq" BETWEEN 1 AND 75)
);
--> statement-breakpoint
CREATE TABLE "game" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(12) NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"status" varchar(10) DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"free_center" boolean DEFAULT true NOT NULL,
	"cards_per_player" smallint DEFAULT 1 NOT NULL,
	"claim_window_seconds" smallint DEFAULT 10 NOT NULL,
	"registration_open" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "game_code_unique" UNIQUE("code"),
	CONSTRAINT "game_status_check" CHECK ("game"."status" IN ('draft', 'open', 'running', 'checking', 'finished')),
	CONSTRAINT "game_cards_per_player_check" CHECK ("game"."cards_per_player" BETWEEN 1 AND 6),
	CONSTRAINT "game_claim_window_check" CHECK ("game"."claim_window_seconds" BETWEEN 3 AND 60)
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "uq_invitation_game_email" UNIQUE("game_id","email")
);
--> statement-breakpoint
CREATE TABLE "participant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"first_name" varchar(60) NOT NULL,
	"last_name" varchar(60) NOT NULL,
	"owner_id" uuid,
	"invitation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prize_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"type" varchar(10) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"quantity" smallint DEFAULT 1 NOT NULL,
	"description" varchar(120),
	"sort_order" smallint NOT NULL,
	CONSTRAINT "uq_prize_rule_game_type" UNIQUE("game_id","type"),
	CONSTRAINT "prize_rule_type_check" CHECK ("prize_rule"."type" IN ('line', 'column', 'diagonal', 'full')),
	CONSTRAINT "prize_rule_quantity_check" CHECK ("prize_rule"."quantity" BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE TABLE "win" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"prize_rule_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"tie_break" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_win_card_prize" UNIQUE("card_id","prize_rule_id")
);
--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_window_id_claim_window_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."claim_window"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_window" ADD CONSTRAINT "claim_window_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw" ADD CONSTRAINT "draw_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_rule" ADD CONSTRAINT "prize_rule_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "win" ADD CONSTRAINT "win_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "win" ADD CONSTRAINT "win_prize_rule_id_prize_rule_id_fk" FOREIGN KEY ("prize_rule_id") REFERENCES "public"."prize_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "win" ADD CONSTRAINT "win_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "win" ADD CONSTRAINT "win_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_card_participant" ON "card" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "idx_claim_window" ON "claim" USING btree ("window_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_claim_window_open" ON "claim_window" USING btree ("game_id") WHERE closed_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_game_owner" ON "game" USING btree ("owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_participant_game" ON "participant" USING btree ("game_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_participant_game_owner" ON "participant" USING btree ("game_id","owner_id") WHERE owner_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_win_game" ON "win" USING btree ("game_id","created_at");