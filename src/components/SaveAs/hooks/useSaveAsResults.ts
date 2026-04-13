import { useCallback, useEffect, useState } from "react";
import { replaceObjectUrl, revokeObjectUrl } from "../export/exportArtifacts";

export const useSaveAsResults = () => {
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [gifBlob, setGifBlob] = useState<Blob | null>(null);
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [gifResultLabel, setGifResultLabel] = useState<string | null>(null);
  const [sequenceBlob, setSequenceBlob] = useState<Blob | null>(null);
  const [contactSheetBlob, setContactSheetBlob] = useState<Blob | null>(null);
  const [contactSheetUrl, setContactSheetUrl] = useState<string | null>(null);

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

  const clearContactSheetResult = useCallback(() => {
    setContactSheetBlob(null);
    setContactSheetUrl((prev) => replaceObjectUrl(prev, null));
  }, []);

  const setContactSheetResult = useCallback((blob: Blob) => {
    setContactSheetBlob(blob);
    setContactSheetUrl((prev) => replaceObjectUrl(prev, blob));
  }, []);

  useEffect(() => {
    return () => {
      revokeObjectUrl(recordedUrl);
      revokeObjectUrl(gifUrl);
      revokeObjectUrl(contactSheetUrl);
    };
  }, [recordedUrl, gifUrl, contactSheetUrl]);

  return {
    recordedBlob,
    recordedUrl,
    gifBlob,
    gifUrl,
    gifResultLabel,
    sequenceBlob,
    contactSheetBlob,
    contactSheetUrl,
    clearRecordedResult,
    setRecordedResult,
    clearGifResult,
    setGifResult,
    clearSequenceResult,
    setSequenceResult,
    clearContactSheetResult,
    setContactSheetResult,
  };
};
