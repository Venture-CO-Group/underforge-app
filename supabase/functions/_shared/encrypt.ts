// Symmetric AES-256-GCM encryption for provider OAuth tokens.
//
// In production we prefer Supabase Vault (if enabled on the project); this
// module is the fallback for environments where Vault isn't wired up yet.
// The encryption key comes from the `WEARABLES_TOKEN_KEY` environment
// variable. It accepts either of these encodings of 32 raw bytes:
//   - 64 hex characters (case-insensitive)
//   - base64 (with or without padding) decoding to 32 bytes
// Rotate by generating a new key, adding it alongside the old one in env as
// `WEARABLES_TOKEN_KEY_V2`, and re-encrypting rows on next refresh.
//
// Wire format for encrypted tokens is `v1:<b64 iv>:<b64 ciphertext>`.

const ALGO: AlgorithmIdentifier = { name: 'AES-GCM', length: 256 } as unknown as AlgorithmIdentifier;

function decodeKeyMaterial(input: string): Uint8Array {
  const trimmed = input.trim();
  // Hex first: 64 chars of [0-9a-f] is unambiguously hex (and also happens
  // to be valid base64, so we must check hex before falling through).
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      out[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  // base64 / base64url, with or without padding.
  let b64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad === 2) b64 += '==';
  else if (pad === 3) b64 += '=';
  else if (pad === 1) {
    throw new Error('WEARABLES_TOKEN_KEY is not valid base64 or hex.');
  }
  try {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    throw new Error('WEARABLES_TOKEN_KEY could not be decoded as hex or base64.');
  }
}

function requireKeyBytes(): Uint8Array {
  const value = Deno.env.get('WEARABLES_TOKEN_KEY');
  if (!value) {
    throw new Error('WEARABLES_TOKEN_KEY is not set; cannot encrypt provider tokens.');
  }
  const raw = decodeKeyMaterial(value);
  if (raw.length !== 32) {
    throw new Error(
      `WEARABLES_TOKEN_KEY must decode to 32 bytes (got ${raw.length}). ` +
        'Provide 64 hex chars or 32 raw bytes base64-encoded.',
    );
  }
  return raw;
}

async function importKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    requireKeyBytes(),
    ALGO,
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptToken(plaintext: string): Promise<string> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  return `v1:${b64(iv)}:${b64(ciphertext)}`;
}

export async function decryptToken(encoded: string): Promise<string> {
  if (!encoded?.startsWith('v1:')) {
    throw new Error('Unsupported token encoding');
  }
  const [, ivB64, ctB64] = encoded.split(':');
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
  const key = await importKey();
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(plaintext);
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
