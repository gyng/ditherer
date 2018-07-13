import * as actions from "@src/actions";
import rootReducer from "@src/reducers";
import { LocationChangeAction, RouterAction } from "react-router-redux";
import { ActionType, StateType } from "typesafe-actions";
import { ThunkAction, ThunkDispatch } from "../../node_modules/redux-thunk";

type ReactRouterAction = RouterAction | LocationChangeAction;

export type RootAction = ReactRouterAction | ActionType<typeof actions>;
export type RootState = StateType<typeof rootReducer>;

/* `any` should be RootAction, but that creates a reference loop when defining actions */
// export type RootThunk = ThunkAction<void, any, null, any>;
export type RootDispatch = ThunkDispatch<RootState, null, RootAction>;
