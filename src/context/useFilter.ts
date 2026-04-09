import { useContext } from "react";
import { FilterContext } from "./filterContextValue";

export const useFilter = (): { state: any; actions: any; filterList: any; grayscale: any } => {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilter must be used within FilterProvider");
  return ctx;
};
