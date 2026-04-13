import { copyBlobToClipboard, downloadBlob, makeFilename } from "../helpers";

export const saveBlob = (blob: Blob | null, ext: string | null) => {
  if (!blob || !ext) return;
  downloadBlob(blob, makeFilename(ext));
};

export const copyBlobWithFeedback = async (
  blob: Blob | null,
  setCopySuccess: (value: boolean) => void,
  warningMessage: string,
) => {
  if (!blob) return;
  try {
    await copyBlobToClipboard(blob);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  } catch (err) {
    console.warn(warningMessage, err);
  }
};
