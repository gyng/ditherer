import { useCallback, useEffect, useState } from "react";
import { replaceObjectUrl, revokeObjectUrl } from "../export/exportArtifacts";

export const useSaveAsResults = () => {
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [gifBlob, setGifBlob] = useState<Blob | null>(null);
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [gifResultLabel, setGifResultLabel] = useState<string | null>(null);
  const [sequenceBlob, setSequenceBlob] = useState<Blob | null>(null);

  const clearRecordedResult = useCallback(() => {
    setRecordedBlob(null);
    setRecordedUrl((prev) => replaceObjectUrl(prev, null));
  }, []);

  const setRecordedResult = useCallback((blob: Blob) => {
    setRecordedBlob(blob);
    setRecordedUrl((prev) => replaceObjectUrl(prev, blob));
  }, []);

  const clearGifResult = useCallback(() => {
    setGifBlob(null);
    setGifResultLabel(null);
    setGifUrl((prev) => replaceObjectUrl(prev, null));
  }, []);

  const setGifResult = useCallback((blob: Blob, label: string) => {
    setGifBlob(blob);
    setGifResultLabel(label);
    setGifUrl((prev) => replaceObjectUrl(prev, blob));
  }, []);

  const clearSequenceResult = useCallback(() => {
    setSequenceBlob(null);
  }, []);

  const setSequenceResult = useCallback((blob: Blob) => {
    setSequenceBlob(blob);
  }, []);

  useEffect(() => {
    return () => {
      revokeObjectUrl(recordedUrl);
      revokeObjectUrl(gifUrl);
    };
  }, [recordedUrl, gifUrl]);

  return {
    recordedBlob,
    recordedUrl,
    gifBlob,
    gifUrl,
    gifResultLabel,
    sequenceBlob,
    clearRecordedResult,
    setRecordedResult,
    clearGifResult,
    setGifResult,
    clearSequenceResult,
    setSequenceResult,
  };
};
