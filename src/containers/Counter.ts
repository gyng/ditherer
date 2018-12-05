import { connect } from "react-redux";

import {
  decrement,
  increment,
  incrementAsync,
  incrementAsyncPromise
} from "@src/actions";
import { Counter, ICounterProps } from "@src/components/Counter";
import { ICountersState } from "@src/reducers/counter";
import { RootDispatch, RootState } from "@src/types";

const mapStateToProps = (state: RootState): ICountersState => ({
  value: state.counters.value
});

const mapDispatchToProps = (dispatch: RootDispatch): ICounterProps => ({
  onDecrementClick: () => {
    dispatch(decrement());
  },
  onIncrementClick: () => {
    dispatch(increment());
  },
  onIncrementClickAsync: () => {
    dispatch(incrementAsync(1, 1000));
  },
  onIncrementClickAsyncPromise: (url: string) => {
    dispatch(incrementAsyncPromise(url)).then(status => {
      window.alert(`Got status code ${status} for ${url}`);
    });
  }
});

// Ignore types for first two generic types of connect for convenience
export const CounterContainer = connect<{}, {}, ICounterProps, RootState>(
  mapStateToProps,
  mapDispatchToProps
)(Counter);
