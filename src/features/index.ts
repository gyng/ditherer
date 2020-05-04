import { booklistDuck } from "./booklist/booklist.duck";
import { counterDuck } from "./counter/counter.duck";

export const featureReducers = {
  booklist: booklistDuck.reducer,
  counter: counterDuck.reducer,
};
