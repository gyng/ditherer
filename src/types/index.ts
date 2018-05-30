export interface ICountersState {
  value: number;
}

export interface IState {
  counters: ICountersState;
}

export enum ActionTypes {
  INCREMENT = "INCREMENT",
  DECREMENT = "DECREMENT"
}

export interface IIncrementAction {
  type: ActionTypes.INCREMENT;
  value: number;
}

export interface IDecrementAction {
  type: ActionTypes.DECREMENT;
  value: number;
}

export type Action = IIncrementAction | IDecrementAction;
