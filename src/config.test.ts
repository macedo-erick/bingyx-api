import { describe, expect, it } from 'vitest';

import { ConfigError, databaseUrl, jwksUri, loadConfig } from './config';

describe('loading the environment', () => {
  it('runs on defaults when nothing is set', () => {
    const config = loadConfig({});

    expect(config.DB_HOST).toBe('localhost');
    expect(config.DB_PORT).toBe(5436);
    expect(config.HTTP_PORT).toBe(8097);
    expect(config.KEYCLOAK_ISSUER_URI).toBe('http://localhost:8098/auth/realms/bingyx');
    expect(config.FEATURE_EMAIL_INVITES).toBe(false);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.LOG_PRETTY).toBe(false);
    expect(config.BINGYX_CORS_ORIGINS).toEqual([]);
  });

  it('reads numbers and flags out of the strings the environment hands over', () => {
    const config = loadConfig({
      DB_PORT: '6543',
      HTTP_PORT: '80',
      LOG_PRETTY: '1',
      FEATURE_EMAIL_INVITES: 'true',
    });

    expect(config.DB_PORT).toBe(6543);
    expect(config.HTTP_PORT).toBe(80);
    expect(config.LOG_PRETTY).toBe(true);
    expect(config.FEATURE_EMAIL_INVITES).toBe(true);
  });

  it('splits the cors origins, trimming each and dropping the empties', () => {
    const config = loadConfig({
      BINGYX_CORS_ORIGINS: 'http://localhost:4203, https://bingyx.example ,,',
    });

    expect(config.BINGYX_CORS_ORIGINS).toEqual(['http://localhost:4203', 'https://bingyx.example']);
  });

  it('names every field it could not accept', () => {
    const load = (): unknown =>
      loadConfig({ DB_PORT: 'nope', FEATURE_EMAIL_INVITES: 'maybe', LOG_LEVEL: 'chatty' });

    expect(load).toThrow(ConfigError);

    try {
      load();
      expect.unreachable('the invalid environment should have thrown');
    } catch (error) {
      const message = (error as Error).message;

      expect(message).toContain('DB_PORT');
      expect(message).toContain('FEATURE_EMAIL_INVITES');
      expect(message).toContain('LOG_LEVEL');
    }
  });

  it('refuses a port that is not a positive whole number', () => {
    expect(() => loadConfig({ DB_PORT: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ DB_PORT: '-1' })).toThrow(ConfigError);
    expect(() => loadConfig({ DB_PORT: '5432.5' })).toThrow(ConfigError);
  });

  it('refuses an issuer that is not a url', () => {
    expect(() => loadConfig({ KEYCLOAK_ISSUER_URI: 'id.example/realms' })).toThrow(ConfigError);
  });
});

describe('what is derived from it', () => {
  it('builds a database url, escaping whatever the password contains', () => {
    const config = loadConfig({
      DB_HOST: 'db.internal',
      DB_PORT: '5432',
      POSTGRES_DB: 'bingyx',
      POSTGRES_USER: 'bing yx',
      POSTGRES_PASSWORD: 'p@ss:word/1',
    });

    expect(databaseUrl(config)).toBe(
      'postgres://bing%20yx:p%40ss%3Aword%2F1@db.internal:5432/bingyx',
    );
    expect(decodeURIComponent(new URL(databaseUrl(config)).password)).toBe('p@ss:word/1');
  });

  it('finds the signing keys under the issuer unless it is told otherwise', () => {
    const derived = loadConfig({ KEYCLOAK_ISSUER_URI: 'https://id.example/realms/bingyx' });
    const explicit = loadConfig({
      KEYCLOAK_ISSUER_URI: 'https://id.example/realms/bingyx',
      KEYCLOAK_JWKS_URI: 'https://keys.example/jwks.json',
    });

    expect(jwksUri(derived).toString()).toBe(
      'https://id.example/realms/bingyx/protocol/openid-connect/certs',
    );
    expect(jwksUri(explicit).toString()).toBe('https://keys.example/jwks.json');
  });
});
