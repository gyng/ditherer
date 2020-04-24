import { Route } from "@src/routes/route";

export const AppRoutes: { [k in string]: Route } = {
  counter: () => "/counter",
  // Example of using parameters
  // counter: (counterId: string = "?") => `/counter/${id}`,
  root: () => "/",
};
