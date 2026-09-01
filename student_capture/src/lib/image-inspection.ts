export interface InspectedImage {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  hasExif: boolean;
}

/** Reads image identity and dimensions from bytes, never from client MIME. */
export function inspectImage(bytes: Uint8Array): InspectedImage | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return {
      mimeType: "image/png",
      width: readU32(bytes, 16),
      height: readU32(bytes, 20),
      hasExif: false,
    };
  }

  if (bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const chunk = ascii(bytes, 12, 4);
    const hasExif = containsAscii(bytes, "EXIF");
    if (chunk === "VP8X") {
      return {
        mimeType: "image/webp",
        width: readU24le(bytes, 24) + 1,
        height: readU24le(bytes, 27) + 1,
        hasExif: hasExif || Boolean(bytes[20]! & 0x08),
      };
    }
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        mimeType: "image/webp",
        width: ((bytes[27]! << 8) | bytes[26]!) & 0x3fff,
        height: ((bytes[29]! << 8) | bytes[28]!) & 0x3fff,
        hasExif,
      };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      return {
        mimeType: "image/webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
        hasExif,
      };
    }
    return null;
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    let width = 0;
    let height = 0;
    let hasExif = false;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1]!;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x00 || marker === 0xff) { offset += 1; continue; }
      const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
      if (length < 2 || offset + 2 + length > bytes.length) return null;
      if (marker === 0xe1 && ascii(bytes, offset + 4, 6) === "Exif\0\0") hasExif = true;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
        width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      }
      offset += 2 + length;
    }
    return width && height ? { mimeType: "image/jpeg", width, height, hasExif } : null;
  }
  return null;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}

function readU24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function containsAscii(bytes: Uint8Array, value: string): boolean {
  const target = [...value].map((character) => character.charCodeAt(0));
  outer: for (let offset = 0; offset <= bytes.length - target.length; offset += 1) {
    for (let index = 0; index < target.length; index += 1) {
      if (bytes[offset + index] !== target[index]) continue outer;
    }
    return true;
  }
  return false;
}
