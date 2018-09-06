import { connect } from "react-redux";

import { decrement, increment, incrementAsync } from "@src/actions";
import { Counter, ICounterProps } from "@src/components/Counter";
import { ICountersState } from "@src/reducers/counter";
import { RootDispatch, RootState } from "@src/types";

const mapStateToProps = (state: RootState): ICountersState => ({
  value: state.counters.value
});

const mapDispatchToProps = (dispatch: RootDispatch): ICounterProps => ({
  onDecrementClick: () => dispatch(decrement()),
  onIncrementClick: () => dispatch(increment()),
  onIncrementClickAsync: () => dispatch(incrementAsync())
});

// Ignore types for first two generic types of connect for convenience
export const CounterContainer = connect<{}, {}, ICounterProps, RootState>(
  mapStateToProps,
  mapDispatchToProps
)(Counter);
