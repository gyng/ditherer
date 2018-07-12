import * as actions from "@src/actions";
import rootReducer from "@src/reducers";
import { LocationChangeAction, RouterAction } from "react-router-redux";
import { ActionType, StateType } from "typesafe-actions";

type ReactRouterAction = RouterAction | LocationChangeAction;

export type RootAction = ReactRouterAction | ActionType<typeof actions>;
export type RootState = StateType<typeof rootReducer>;
