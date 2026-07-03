export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  let path = u.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return u.origin + path + u.search + u.hash;
}
