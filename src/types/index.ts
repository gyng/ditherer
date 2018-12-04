import * as actions from "@src/actions";
import { rootReducer } from "@src/reducers";
import { ActionType, StateType } from "typesafe-actions";
import { ThunkDispatch } from "../../node_modules/redux-thunk";

export type RootAction = ActionType<typeof actions>;

// rootReducer is a function to accomodate connected-react-router
export type RootState = StateType<ReturnType<typeof rootReducer>>;

// export type RootThunk = ThunkAction<void, RootState, null, RootAction>;
export type RootDispatch = ThunkDispatch<RootState, null, RootAction>;
