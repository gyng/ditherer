import { useContext } from "react";
import { FilterContext, type FilterContextValue } from "./filterContextValue";

export const useFilter = (): FilterContextValue => {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilter must be used within FilterProvider");
  return ctx;
};
