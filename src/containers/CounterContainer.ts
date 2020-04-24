import { connect } from "react-redux";

import {
  decrement,
  increment,
  incrementAsync,
  incrementAsyncNetwork,
} from "@src/actions";
import { Counter, CounterProps } from "@src/components/Counter";
import { CountersState } from "@src/reducers/counter";
import { RootDispatch, RootState } from "@src/types";

const mapStateToProps = (state: RootState): CountersState => ({
  value: state.counters.value,
});

const mapDispatchToProps = (dispatch: RootDispatch): CounterProps => ({
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
    dispatch(incrementAsyncNetwork.request(url));

    fetch(url)
      .then((res) => {
        dispatch(incrementAsyncNetwork.success(res.status));
        dispatch(increment(res.status));
        window.alert(`Got status code ${status} for ${url}`);
        return res.status;
      })
      .catch((res) => {
        dispatch(incrementAsyncNetwork.failure(res));
      });
  },
});

export const CounterContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Counter);
