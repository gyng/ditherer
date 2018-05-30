import { connect } from "react-redux";

import { decrement, increment, incrementAsync } from "@src/actions";
import Counter from "@src/components/Counter";
import { Action, IState } from "@src/types";
import { Dispatch } from "redux";

const mapStateToProps = (state: IState) => ({ value: state.counters.value });

const mapDispatchToProps = (dispatch: any) => ({
  onDecrementClick: () => dispatch(decrement()),
  onIncrementClick: () => dispatch(increment()),
  onIncrementClickAsync: () => dispatch(incrementAsync())
});

const ContainedCounter = connect(
  mapStateToProps,
  mapDispatchToProps
)(Counter);

export default ContainedCounter;
