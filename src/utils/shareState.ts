import { strFromU8, strToU8, zlibSync, unzlibSync } from "fflate";

const COMPRESSED_PREFIX = "z:";

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const toBase64Url = (bytes: Uint8Array): string =>
  bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const fromBase64Url = (base64url: string): Uint8Array => {
  const padding = (4 - (base64url.length % 4)) % 4;
  const normalized = `${base64url.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat(padding)}`;
  return base64ToBytes(normalized);
};

export const encodeShareState = (json: string): string =>
  `${COMPRESSED_PREFIX}${toBase64Url(zlibSync(strToU8(json)))}`;

export const decodeShareState = (encoded: string): string => {
  if (!encoded.startsWith(COMPRESSED_PREFIX)) {
    throw new Error("Unsupported share URL format");
  }

  const compressed = fromBase64Url(encoded.slice(COMPRESSED_PREFIX.length));
  return strFromU8(unzlibSync(compressed));
};
