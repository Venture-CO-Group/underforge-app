import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase_db_new';
import { glowLogger } from './glow-logger';

const AVATARS_BUCKET = 'avatars';
const SOCIAL_POSTS_BUCKET = 'social-posts';
const CIRCLE_IMAGES_BUCKET = 'circle-images';
const BODY_PHOTOS_BUCKET = 'body-photos';

export type BodyPhotoAngle = 'front' | 'side' | 'back';

// Decode a base64 string into a Uint8Array. We avoid adding a runtime dep for
// this single use; React Native's `atob` (via url-polyfill) gives us the
// binary string, which we then expand byte-by-byte.
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = (globalThis as any).atob(base64) as string;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Read a local image URI as base64, decode into ArrayBuffer, and upload to a
 * Supabase Storage bucket. Returns the bucket-relative path on success or null
 * on failure. Supabase JS in React Native cannot consume File/Blob reliably,
 * so we always go through base64 -> ArrayBuffer.
 */
async function uploadImageFromUri(
  bucket: string,
  path: string,
  localUri: string,
  contentType: string = 'image/jpeg',
): Promise<string | null> {
  if (!supabase) {
    glowLogger.warn('Supabase not initialized, cannot upload image', { bucket, path });
    return null;
  }

  try {
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = base64ToUint8Array(base64);

    const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
      contentType,
      upsert: true,
    });

    if (error) {
      glowLogger.error('Supabase storage upload failed', {
        bucket,
        path,
        error: error.message || String(error),
      });
      return null;
    }

    return path;
  } catch (error) {
    glowLogger.error('Failed to upload image to Supabase Storage', {
      bucket,
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Build a public URL for an object in a public bucket. Returns null if the
 * client is uninitialized or the call fails.
 */
function publicUrlFor(bucket: string, path: string): string | null {
  if (!supabase) return null;
  try {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (error) {
    glowLogger.error('Failed to resolve public URL', {
      bucket,
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Upload a user's avatar. Path is deterministic (`{userId}/avatar.jpg`) so a
 * fresh upload overwrites the previous photo and bypasses any CDN caching that
 * lookups by hashed name would otherwise require.
 */
export async function uploadAvatar(userId: string, localUri: string): Promise<string | null> {
  const path = `${userId}/avatar.jpg`;
  const uploaded = await uploadImageFromUri(AVATARS_BUCKET, path, localUri);
  if (!uploaded) return null;
  // Append a cache-busting query so re-uploads display the new image immediately.
  const url = publicUrlFor(AVATARS_BUCKET, path);
  return url ? `${url}?v=${Date.now()}` : null;
}

/** Delete the current user's avatar object. Idempotent. */
export async function deleteAvatar(userId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.storage.from(AVATARS_BUCKET).remove([`${userId}/avatar.jpg`]);
  } catch (error) {
    glowLogger.warn('Avatar delete failed (continuing)', {
      user_id: userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Upload a photo to attach to a social post. Path includes a random suffix so
 * multiple posts can each keep their own image even if uploaded back-to-back.
 */
/**
 * Upload a forging-circle cover image. Path is `{ownerUserId}/{circleId}.jpg` so
 * re-uploads overwrite the previous file.
 */
export async function uploadCircleImage(
  ownerUserId: string,
  circleId: number,
  localUri: string,
): Promise<string | null> {
  const path = `${ownerUserId}/${circleId}.jpg`;
  const uploaded = await uploadImageFromUri(CIRCLE_IMAGES_BUCKET, path, localUri);
  if (!uploaded) return null;
  const url = publicUrlFor(CIRCLE_IMAGES_BUCKET, path);
  return url ? `${url}?v=${Date.now()}` : null;
}

export async function uploadPostPhoto(userId: string, localUri: string): Promise<string | null> {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `${userId}/${suffix}.jpg`;
  const uploaded = await uploadImageFromUri(SOCIAL_POSTS_BUCKET, path, localUri);
  if (!uploaded) return null;
  return publicUrlFor(SOCIAL_POSTS_BUCKET, path);
}

/**
 * Upload a weekly body-progress photo for one angle. Path is deterministic per
 * ISO week (`{userId}/{year}_W{week}_{angle}.jpg`) so re-uploading a week's photo
 * overwrites the previous file (no orphans) and maps 1:1 to the chart's bars.
 */
export async function uploadBodyPhoto(
  userId: string,
  year: number,
  week: number,
  angle: BodyPhotoAngle,
  localUri: string,
): Promise<string | null> {
  const path = `${userId}/${year}_W${week}_${angle}.jpg`;
  const uploaded = await uploadImageFromUri(BODY_PHOTOS_BUCKET, path, localUri);
  if (!uploaded) return null;
  // Cache-bust so a re-uploaded week shows the new photo immediately.
  const url = publicUrlFor(BODY_PHOTOS_BUCKET, path);
  return url ? `${url}?v=${Date.now()}` : null;
}
