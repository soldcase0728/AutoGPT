"use client";

import { useEffect, useRef, useState } from "react";
import type { PromptOrientation } from "@/lib/types";
import { stripJpegMetadata } from "@/lib/image-inspection";

interface CapturedPhoto {
  file: File;
  url: string;
}

export function PhotoCamera({
  orientation,
  maxCount,
  disabled,
  onChange,
}: {
  orientation: PromptOrientation;
  maxCount: number;
  disabled: boolean;
  onChange: (files: File[]) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [error, setError] = useState("");

  useEffect(
    () => () => streamRef.current?.getTracks().forEach((track) => track.stop()),
    [],
  );

  // Tell the page after React has settled the list, never from inside an update.
  const reported = useRef<CapturedPhoto[]>(photos);
  useEffect(() => {
    if (reported.current === photos) return;
    reported.current = photos;
    onChange(photos.map((photo) => photo.file));
  }, [photos, onChange]);

  function stop() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
  }

  async function start(nextFacing = facing) {
    stop();
    setError("");
    try {
      const aspectRatio =
        orientation === "portrait" ? 9 / 16 : orientation === "landscape" ? 16 / 9 : 1;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: nextFacing }, aspectRatio: { ideal: aspectRatio } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
    } catch {
      setError("Camera access was blocked. Allow camera access and try again.");
    }
  }

  /**
   * Draw a frame or a picked picture onto a canvas and keep the JPEG. Canvas
   * emits fresh pixels only: EXIF, GPS and the source filename do not survive
   * this boundary, whether the picture came from the camera or the camera roll.
   */
  function keep(source: CanvasImageSource, width: number, height: number): Promise<boolean> {
    let sx = 0;
    let sy = 0;
    let sw = width;
    let sh = height;
    if (orientation === "square") {
      const side = Math.min(sw, sh);
      sx = (sw - side) / 2;
      sy = (sh - side) / 2;
      sw = side;
      sh = side;
    }
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d")?.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    return new Promise((resolve) =>
      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(false);
          // Safari writes its own small EXIF block into canvas JPEGs; take
          // every metadata segment out before the photo leaves the phone.
          void blob.arrayBuffer().then(
            (buffer) => {
              const clean = stripJpegMetadata(new Uint8Array(buffer));
              const file = new File([clean as BlobPart], `capture-${Date.now()}.jpg`, {
                type: "image/jpeg",
                lastModified: Date.now(),
              });
              setPhotos((previous) => {
                if (previous.length >= maxCount) return previous;
                return [...previous, { file, url: URL.createObjectURL(file) }];
              });
              resolve(true);
            },
            () => resolve(false),
          );
        },
        "image/jpeg",
        0.9,
      ),
    );
  }

  async function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth || photos.length >= maxCount) return;
    if (!(await keep(video, video.videoWidth, video.videoHeight))) {
      setError("The camera could not create that photo. Try again.");
      return;
    }
    if (photos.length + 1 >= maxCount) stop();
  }

  /** Photos from the camera roll, upright and stripped the same way as live ones. */
  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []).slice(0, maxCount - photos.length);
    event.target.value = "";
    if (!chosen.length) return;
    stop();
    setError("");
    for (const file of chosen) {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        const ok = await keep(bitmap, bitmap.width, bitmap.height);
        bitmap.close();
        if (!ok) throw new Error("encode");
      } catch {
        setError("One of those photos couldn't be opened. Try a different one, or take it with the camera.");
      }
    }
  }

  function remove(index: number) {
    setPhotos((previous) => {
      URL.revokeObjectURL(previous[index]?.url ?? "");
      const next = previous.filter((_, photoIndex) => photoIndex !== index);
      return next;
    });
  }

  function move(index: number, direction: -1 | 1) {
    setPhotos((previous) => {
      const target = index + direction;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      {!active && photos.length < maxCount && (
        <div className="grid gap-2 sm:grid-cols-2">
          <button className="btn" type="button" disabled={disabled} onClick={() => void start()}>
            {photos.length ? "Take another" : "Take a photo now"}
          </button>
          <label
            className={`btn btn-quiet block cursor-pointer text-center ${disabled ? "pointer-events-none opacity-40" : ""}`}
          >
            Choose from camera roll
            <input
              type="file"
              className="sr-only"
              accept="image/*"
              multiple={maxCount - photos.length > 1}
              disabled={disabled}
              onChange={(event) => void pick(event)}
            />
          </label>
        </div>
      )}
      <div className={active ? "relative overflow-hidden rounded-sm bg-black" : "hidden"}>
        <video ref={videoRef} muted playsInline className="max-h-[65vh] w-full object-contain" />
        {orientation !== "any" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-4 rounded-sm border-2 border-white/80"
            style={{
              aspectRatio:
                orientation === "portrait" ? "9 / 16" : orientation === "landscape" ? "16 / 9" : "1 / 1",
              maxHeight: "calc(100% - 2rem)",
              maxWidth: "calc(100% - 2rem)",
              margin: "auto",
            }}
          />
        )}
      </div>
      {active && (
        <div className="flex flex-wrap gap-2">
          <button className="btn" type="button" onClick={() => void capture()}>Take photo</button>
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => {
              const next = facing === "environment" ? "user" : "environment";
              setFacing(next);
              void start(next);
            }}
          >
            Switch camera
          </button>
          <button className="btn btn-quiet" type="button" onClick={stop}>Close</button>
        </div>
      )}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((photo, index) => (
            <div key={photo.url} className="card overflow-hidden p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={`Photo ${index + 1}`} className="aspect-square w-full object-cover" />
              <div className="mt-2 flex justify-between gap-1 text-xs">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0}>←</button>
                <button type="button" onClick={() => remove(index)}>Retake</button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === photos.length - 1}>→</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-sm" style={{ color: "var(--clay)" }}>{error}</p>}
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        {photos.length} of {maxCount} · Location and camera details are removed from every photo before it uploads.
      </p>
    </div>
  );
}
