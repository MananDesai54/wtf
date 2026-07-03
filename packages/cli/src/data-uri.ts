export function parseDataUri(src: string): { mime: string; base64: string } | null {
  const m = /^data:([^,]*),(.*)$/.exec(src);
  if (!m) return null;
  const meta = m[1].split(';');
  const mime = meta[0] || 'image/png';
  const isBase64 = meta.includes('base64');
  try {
    const base64 = isBase64 ? m[2] : Buffer.from(decodeURIComponent(m[2])).toString('base64');
    return { mime, base64 };
  } catch {
    return null;
  }
}
