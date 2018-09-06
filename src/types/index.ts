import * as actions from "@src/actions";
import { rootReducer } from "@src/reducers";
import { ActionType, StateType } from "typesafe-actions";
import { ThunkDispatch } from "../../node_modules/redux-thunk";

export type RootAction = ActionType<typeof actions>;
export type RootState = StateType<typeof rootReducer>;

// export type RootThunk = ThunkAction<void, RootState, null, RootAction>;
export type RootDispatch = ThunkDispatch<RootState, null, RootAction>;
