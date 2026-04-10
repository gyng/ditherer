import { encodeShareState } from "utils/shareState";

export const getShareHash = (
  stateJson: string,
  defaultStateJson: string
): string => {
  if (stateJson === defaultStateJson) return "";
  return `#!${encodeShareState(stateJson)}`;
};

export const getShareUrl = (
  pathname: string,
  search: string,
  hash: string
): string => `${pathname}${search}${hash}`;
