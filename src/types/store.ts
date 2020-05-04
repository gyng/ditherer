import { combineReducers } from "redux";
import { configureStore } from "@reduxjs/toolkit";

import { domainReducers } from "@src/domains";
import { featureReducers } from "@src/features";

const features = combineReducers(featureReducers);
const domains = combineReducers(domainReducers);

const rootReducer = combineReducers({
  domains,
  features,
});

export type RootState = ReturnType<typeof rootReducer>;

export const store = configureStore({
  reducer: rootReducer,
  // We don't have any custom middleware, so this is commented out
  // middleware: [...getDefaultMiddleware<RootState>()] as const,
});
export type RootDispatch = typeof store.dispatch;
