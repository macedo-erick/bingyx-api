import { z } from 'zod';

const flag = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((value) => value === 'true' || value === '1');

const schema = z.object({
  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5436),
  POSTGRES_DB: z.string().min(1).default('bingyx'),
  POSTGRES_USER: z.string().min(1).default('bingyx'),
  POSTGRES_PASSWORD: z.string().min(1).default('bingyx'),

  HTTP_HOST: z.string().min(1).default('127.0.0.1'),
  HTTP_PORT: z.coerce.number().int().positive().default(8097),

  KEYCLOAK_ISSUER_URI: z.url().default('http://localhost:8098/auth/realms/bingyx'),
  KEYCLOAK_JWKS_URI: z.url().optional(),

  // Signs the tokens players carry after joining through a link; they never see Keycloak.
  PLAYER_TOKEN_SECRET: z.string().min(32).default('local-dev-player-token-secret-not-for-prod'),
  PLAYER_TOKEN_TTL: z.string().min(1).default('14d'),

  BINGYX_CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ''),
    ),

  // Off until there is a domain to send from; invitations go out as a link meanwhile.
  FEATURE_EMAIL_INVITES: flag,

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: flag,
});

export type Config = z.infer<typeof schema>;

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);

  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new ConfigError(`Invalid environment configuration:\n${detail}`);
  }

  return result.data;
}

export function databaseUrl(config: Config): string {
  const { DB_HOST, DB_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD } = config;
  const credentials = `${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(POSTGRES_PASSWORD)}`;

  return `postgres://${credentials}@${DB_HOST}:${String(DB_PORT)}/${POSTGRES_DB}`;
}

export function jwksUri(config: Config): URL {
  if (config.KEYCLOAK_JWKS_URI !== undefined) {
    return new URL(config.KEYCLOAK_JWKS_URI);
  }

  return new URL(`${config.KEYCLOAK_ISSUER_URI}/protocol/openid-connect/certs`);
}

export const CONFIG = Symbol('BINGYX_CONFIG');
