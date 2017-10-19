export interface CountersState {
  value: number;
}

export interface State {
  counters: CountersState;
}

export enum ActionTypes {
  INCREMENT = "INCREMENT",
  DECREMENT = "DECREMENT"
}

export interface IncrementAction {
  type: ActionTypes.INCREMENT;
  value: number;
}

export interface DecrementAction {
  type: ActionTypes.DECREMENT;
  value: number;
}

export type Action = IncrementAction | DecrementAction;
