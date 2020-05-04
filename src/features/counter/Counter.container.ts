import { connect } from "react-redux";

import { RootDispatch, RootState } from "@src/types";
import { Counter } from "./Counter";
import { counterDuck } from "./counter.duck";

const mapStateToProps = (state: RootState) => ({
  // Direct access is acceptable for this, but counterDuck.selectors are recommended for type-safety
  // value: state.features.counters.value,
  value: counterDuck.selectors.count(state.features.counter),
});

const mapDispatchToProps = (dispatch: RootDispatch) => ({
  onDecrementClick: () => {
    dispatch(counterDuck.actions.decrement());
  },
  onIncrementClick: () => {
    dispatch(counterDuck.actions.increment(1));
  },
  onIncrementClickAsync: () => {
    dispatch(counterDuck.actions.incrementAsync(1, 1000));
  },
  onIncrementClickAsyncPromise: async (url: string) => {
    dispatch(counterDuck.actions.fetchCode(url)).then((res) => {
      if (counterDuck.actions.fetchCode.fulfilled.match(res)) {
        dispatch(counterDuck.actions.increment(res.payload));
      } else {
        window.alert("network error " + res.error.message);
      }
    });
  },
  onIncrementClickAsyncAwait: async (url: string) => {
    const res = await dispatch(counterDuck.actions.fetchCode(url));
    console.log(res);

    if (counterDuck.actions.fetchCode.fulfilled.match(res)) {
      dispatch(counterDuck.actions.increment(res.payload));
    } else if (res.payload) {
      window.alert("application error" + JSON.stringify(res));
    } else {
      window.alert("network error " + res.error.message);
    }
  },
});

export const CounterContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Counter);
