"use client";

import { useEffect, useRef, useState } from "react";
import type { PromptOrientation } from "@/lib/types";

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

  function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth || photos.length >= maxCount) return;
    const canvas = document.createElement("canvas");
    let sx = 0;
    let sy = 0;
    let sw = video.videoWidth;
    let sh = video.videoHeight;
    if (orientation === "square") {
      const side = Math.min(sw, sh);
      sx = (sw - side) / 2;
      sy = (sh - side) / 2;
      sw = side;
      sh = side;
    }
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d")?.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    canvas.toBlob(
      (blob) => {
        if (!blob) return setError("The camera could not create that photo. Try again.");
        // Canvas emits fresh pixels only: EXIF, GPS, and the source filename do
        // not survive this boundary.
        const file = new File([blob], `capture-${Date.now()}.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
        const next = [...photos, { file, url: URL.createObjectURL(file) }];
        setPhotos(next);
        onChange(next.map((photo) => photo.file));
        if (next.length >= maxCount) stop();
      },
      "image/jpeg",
      0.9,
    );
  }

  function remove(index: number) {
    setPhotos((previous) => {
      URL.revokeObjectURL(previous[index]?.url ?? "");
      const next = previous.filter((_, photoIndex) => photoIndex !== index);
      onChange(next.map((photo) => photo.file));
      return next;
    });
  }

  function move(index: number, direction: -1 | 1) {
    setPhotos((previous) => {
      const target = index + direction;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target]!, next[index]!];
      onChange(next.map((photo) => photo.file));
      return next;
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      {!active && photos.length < maxCount && (
        <button className="btn" type="button" disabled={disabled} onClick={() => void start()}>
          {photos.length ? "Add another photo" : "Open camera"}
        </button>
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
          <button className="btn" type="button" onClick={capture}>Take photo</button>
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
              <img src={photo.url} alt={`Captured photo ${index + 1}`} className="aspect-square w-full object-cover" />
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
        {photos.length} of {maxCount} · Photos are re-encoded before upload, removing location and EXIF data.
      </p>
    </div>
  );
}
