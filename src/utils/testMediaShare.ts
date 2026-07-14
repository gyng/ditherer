export const TEST_MEDIA_PARAM = "testMedia";

export const TEST_IMAGE_FILES = [
  "BoatsColor.png",
  "DSCF0491.JPG@800.avif",
  "DSCF1248.JPG@1600.avif",
  "ZeldaColor.png",
  "airplane.png",
  "baboon.png",
  "barbara.png",
  "fruits.png",
  "goldhill.png",
  "lenna.png",
  "monarch.png",
  "pepper.png",
  "sailboat.png",
  "soccer.png",
] as const;

export const TEST_VIDEO_FILES = [
  "118-60i.mp4",
  "120-60i.mp4",
  "164-60i.mp4",
  "207-60p.mp4",
  "DSCF0159.MOV@1280.mp4",
  "akiyo.mp4",
  "badapple-trimp.mp4",
  "bowing_cif.mp4",
  "c01_Fireworks_willow_4K_960x540.mp4",
  "carphone_qcif.mp4",
  "city_4cif.mp4",
  "degauss.webm",
  "highway_cif.mp4",
  "ice_4cif.mp4",
  "kumiko.webm",
  "pamphlet_cif.mp4",
  "rush_hour_1080p25.mp4",
  "salesman_qcif.mp4",
  "stefan_sif.mp4",
  "suzie.mp4",
  "tempete_cif.mp4",
  "tt_sif.mp4",
  "vtc1nw_422_cif.mp4",
  "waterfall_cif.mp4",
] as const;

export type TestMediaKind = "image" | "video";
export type SharedTestMedia = { kind: TestMediaKind; file: string };

const allowedFiles: Record<TestMediaKind, ReadonlySet<string>> = {
  image: new Set(TEST_IMAGE_FILES),
  video: new Set(TEST_VIDEO_FILES),
};

const validateSharedTestMedia = (
  media: SharedTestMedia | null | undefined,
): SharedTestMedia | null => {
  if (!media || !allowedFiles[media.kind]?.has(media.file)) return null;
  return { kind: media.kind, file: media.file };
};

export const parseSharedTestMedia = (search: string): SharedTestMedia | null => {
  const raw = new URLSearchParams(search).get(TEST_MEDIA_PARAM);
  if (!raw) return null;
  const separator = raw.indexOf(":");
  if (separator <= 0) return null;
  const kind = raw.slice(0, separator);
  if (kind !== "image" && kind !== "video") return null;
  return validateSharedTestMedia({ kind, file: raw.slice(separator + 1) });
};

export const sharedTestMediaForSource = (
  kind: TestMediaKind,
  src: string,
): SharedTestMedia | null => {
  const path = src.split(/[?#]/, 1)[0];
  const file = path.split("/").pop() || "";
  return validateSharedTestMedia({ kind, file });
};

export const updateTestMediaSearch = (
  search: string,
  media: SharedTestMedia | null,
): string => {
  const params = new URLSearchParams(search);
  const valid = validateSharedTestMedia(media);
  if (valid) params.set(TEST_MEDIA_PARAM, `${valid.kind}:${valid.file}`);
  else params.delete(TEST_MEDIA_PARAM);
  const next = params.toString();
  return next ? `?${next}` : "";
};

export const getShareableTestMediaSearch = (search: string): string =>
  updateTestMediaSearch("", parseSharedTestMedia(search));
