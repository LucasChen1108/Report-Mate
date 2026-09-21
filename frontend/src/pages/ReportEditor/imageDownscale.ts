// imageDownscale.ts — shrink a camera photo before it becomes a data URL.
//
// WHY THIS EXISTS (it is not an optimization):
//
// Report photos are stored as inline base64 data URLs inside the report JSON —
// a deliberate tradeoff for this stage (no blob store, and an inline image
// embeds straight into the printed/exported document). That is only safe while
// the images are SMALL. A modern phone camera produces a 2–5 MB JPEG; base64
// inflates it by a further ~33%; the server caps a report body at 32 MB. Three
// untouched photos therefore fail the save — on exactly the reports that matter
// most, the ones a technician documented thoroughly.
//
// So every image goes through a canvas first: longest edge clamped to 1600px,
// re-encoded as JPEG at quality 0.8. A 2 MB phone photo lands around 200 KB and
// is still perfectly legible at A4 print size (1600px across a 178mm content
// width is ~230 DPI).
//
// This is a PIPELINE change only. The value written is still a PhotoValue
// ({dataUrl, caption, fileName}) — nothing about the stored shape changes.
//
// Two deliberate consequences:
//   - Output is always JPEG, so transparency is flattened. Report photos are
//     camera images; none of them have an alpha channel.
//   - Re-encoding drops EXIF, including the orientation tag. createImageBitmap
//     is called with `imageOrientation: "from-image"` so the rotation is BAKED
//     INTO the pixels before the tag is lost — without that, portrait phone
//     photos come out sideways.

/** Longest-edge cap in pixels. ~230 DPI across an A4 content width. */
export const MAX_IMAGE_EDGE = 1600;

/** JPEG quality for the re-encode. 0.8 is the usual knee: visually clean,
 * roughly a tenth the bytes of a camera original. */
export const IMAGE_JPEG_QUALITY = 0.8;

/** Below this, an image that could not be decoded is passed through as-is
 * rather than rejected: it is small enough to be harmless, and losing a
 * technician's photo is worse than storing a slightly larger one. */
const PASSTHROUGH_LIMIT_BYTES = 512 * 1024;

/** Read a File as a data URL. Only used for the passthrough fallback below —
 * the happy path never produces an un-downscaled data URL. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Could not read the image file."));
    reader.onerror = () => reject(reader.error ?? new Error("Read failed."));
    reader.readAsDataURL(file);
  });
}

/** Decode a file to something canvas can draw.
 *
 * createImageBitmap is the primary path: it decodes off the main thread and
 * applies EXIF orientation for us. Not every browser/format combination
 * supports it, so an <img> + object URL is the fallback (the browser applies
 * orientation there too, via the default image-orientation: from-image). */
async function decode(file: File): Promise<CanvasImageSource & {
  width: number;
  height: number;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through to the <img> path.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode the image."));
      img.src = url;
    });
  } finally {
    // Safe immediately: decoding has finished (or failed) by now, and the
    // drawn pixels do not reference the URL.
    URL.revokeObjectURL(url);
  }
}

/** Target dimensions with the aspect ratio preserved and the longest edge
 * capped. An image already within the cap is NOT upscaled — it is still
 * re-encoded, which is where a large PNG or an over-quality JPEG loses its
 * bulk. */
export function scaledDimensions(
  width: number,
  height: number,
  maxEdge: number = MAX_IMAGE_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) {
    return { width, height };
  }
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * Downscale and re-encode an image file, returning a JPEG data URL.
 *
 * Throws only when the file cannot be decoded AND is large enough that storing
 * it untouched would risk the body cap — the caller surfaces that message next
 * to the upload control rather than silently attaching nothing.
 */
export async function downscaleImageToDataUrl(
  file: File,
  options?: { maxEdge?: number; quality?: number },
): Promise<string> {
  const maxEdge = options?.maxEdge ?? MAX_IMAGE_EDGE;
  const quality = options?.quality ?? IMAGE_JPEG_QUALITY;

  let source: Awaited<ReturnType<typeof decode>>;
  try {
    source = await decode(file);
  } catch (err) {
    if (file.size <= PASSTHROUGH_LIMIT_BYTES) return readAsDataUrl(file);
    throw err instanceof Error ? err : new Error("Could not read the image.");
  }

  try {
    const { width, height } = scaledDimensions(
      source.width,
      source.height,
      maxEdge,
    );

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      // No 2D context (rare, but it happens under memory pressure and in some
      // headless environments). Same rule as a decode failure.
      if (file.size <= PASSTHROUGH_LIMIT_BYTES) return readAsDataUrl(file);
      throw new Error("Could not process the image on this device.");
    }

    // JPEG has no alpha, so an un-painted canvas would flatten to black.
    // Paint white first: a transparent PNG then reads the way it looked.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);

    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    // ImageBitmaps hold decoded pixels outside the JS heap; release them rather
    // than waiting for GC, since a technician may attach several photos in a row.
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
      source.close();
    }
  }
}
