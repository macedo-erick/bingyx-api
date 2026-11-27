interface PostgresError {
  readonly code?: unknown;
  readonly constraint_name?: unknown;
}

// Drizzle wraps the driver's error in its own, so the Postgres fields may sit one level down.
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let current = error; typeof current === 'object' && current !== null;) {
    const candidate = current as PostgresError;

    if (candidate.code === '23505' && candidate.constraint_name === constraint) {
      return true;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return false;
}
