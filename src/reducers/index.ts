import { connectRouter } from "connected-react-router";
import { History } from "history";
import { combineReducers } from "redux";

import { counterReducer } from "./counter";

export const rootReducer = (history: History) =>
  combineReducers({
    counters: counterReducer,
    router: connectRouter(history)
  });
