/**
 * Phone photos are often 5 to 10 MB. Instead of refusing them, shrink them in the
 * browser before upload: the longest side is capped and the picture re-encoded.
 * Small images are left untouched so nothing is degraded needlessly.
 */
export const IMAGE_MAX_SIDE = 1600;
const KEEP_ORIGINAL_BELOW_BYTES = 800 * 1024;
const QUALITY = 0.85;

export function fitWithin(width: number, height: number, maxSide: number) {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const ratio = maxSide / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

function toBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

async function decode(file: File): Promise<ImageBitmap | null> {
  try {
    // Apply the EXIF orientation: otherwise a portrait photo may come out sideways.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      return null;
    }
  }
}

function renamed(name: string, type: string) {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  return `${base}.${type === "image/webp" ? "webp" : "jpg"}`;
}

/** Returns a smaller image when that helps, otherwise the original file. Never throws. */
export async function prepareImage(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  const bitmap = await decode(file);
  if (!bitmap) return file;

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, IMAGE_MAX_SIDE);
    const shrunk = width !== bitmap.width || height !== bitmap.height;
    if (!shrunk && file.size <= KEEP_ORIGINAL_BELOW_BYTES) return file;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);

    let blob = await toBlob(canvas, "image/webp");
    if (blob?.type !== "image/webp") {
      // This browser cannot encode WebP: use JPEG, on a white background (JPEG has no transparency).
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      blob = await toBlob(canvas, "image/jpeg");
    }
    if (!blob) return file;
    // Keep the original when the re-encoded picture is not smaller and nothing was resized.
    if (!shrunk && blob.size >= file.size) return file;
    return new File([blob], renamed(file.name, blob.type), { type: blob.type, lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}
