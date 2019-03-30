import { Action, AnyAction } from "redux";
import { ThunkAction, ThunkDispatch } from "redux-thunk";
import { StateType } from "typesafe-actions";

import * as actions from "@src/actions";
import { rootReducer } from "@src/reducers";
import { ActionCreatorMap } from "typesafe-actions/dist/type-helpers";

// RootActionType<T> fixes a breakage in TS 3.4 where the type inference fails to infer `typeof actions`.
// Try using `RootAction = ActionType<typeof actions>` when it's fixed.
declare type RootActionType<T> = ActionCreatorMap<T>[keyof T];
export type RootAction = RootActionType<typeof actions>;

// rootReducer is a function to accomodate connected-react-router so we have to use ReturnType
export type RootState = StateType<ReturnType<typeof rootReducer>>;
// Change Action to RootAction when redux-thunk updates its typpings for 3.4
export type RootDispatch = ThunkDispatch<RootState, Promise<any>, RootAction>;

/**
 * Represents a thunk action that does not returns a Promise.
 *
 * - `A` possible dispatched actions, defaults to `AnyAction`
 * - `E` extra args of redux-thunk, defaults to `any`
 */
export type RootThunk<A extends Action = AnyAction, E = any> = ThunkAction<
  void,
  any, // This (S, the state) is lenient to satisfy RootDispatch (because of typesafe-actions)
  E,
  A
>;

/**
 * Represents a thunk action that returns a Promise.
 *
 * - `PR` return value of Promise
 * - `A` possible dispatched actions, defaults to `AnyAction`
 * - `E` extra args of redux-thunk, defaults to `any`
 */
export type RootThunkPromise<
  PR = any,
  A extends Action = AnyAction,
  E = any
> = ThunkAction<
  Promise<PR>,
  any, // This (S, the state) is lenient to satisfy RootDispatch (because of typesafe-actions)
  E,
  A
>;
