export const humanizeControlName = (value: string) => {
  const spaced = value
    .replace(
      /([a-z0-9])([A-Z])/g,
      (_, before: string, after: string) => `${before} ${after.toLowerCase()}`,
    )
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return spaced || value;
};
