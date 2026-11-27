export function bearerToken(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }

  const [scheme, ...rest] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || rest.length !== 1) {
    return null;
  }

  return rest[0] ?? null;
}
