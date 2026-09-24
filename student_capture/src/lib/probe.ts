"use client";

export interface Probe {
  durationSeconds?: number;
  width?: number;
  height?: number;
}

/**
 * Reads dimensions and duration straight off the file in the browser, so the
 * craft checks can run before a single byte is uploaded. Best effort: a codec
 * the browser cannot decode simply yields nothing, and the checks are skipped
 * rather than blocking the student.
 */
export function probeMedia(file: File): Promise<Probe> {
  const url = URL.createObjectURL(file);
  const done = (probe: Probe) => {
    URL.revokeObjectURL(url);
    return probe;
  };

  if (file.type.startsWith("image/")) {
    return new Promise<Probe>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(done({ width: img.naturalWidth, height: img.naturalHeight }));
      img.onerror = () => resolve(done({}));
      img.src = url;
    });
  }

  return new Promise<Probe>((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      resolve(
        done({
          durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined,
          width: video.videoWidth || undefined,
          height: video.videoHeight || undefined,
        }),
      );
    video.onerror = () => resolve(done({}));
    video.src = url;
  });
}

export function mediaKind(file: File): "video" | "photo" {
  return file.type.startsWith("image/") ? "photo" : "video";
}

/** The same facts for media that has already been uploaded, read from its URL. */
export function probeUrl(url: string, kind: "photo" | "video"): Promise<Probe> {
  if (kind === "photo") {
    return new Promise<Probe>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({});
      img.src = url;
    });
  }
  return new Promise<Probe>((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () =>
      resolve({
        durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
      });
    video.onerror = () => resolve({});
    video.src = url;
  });
}
