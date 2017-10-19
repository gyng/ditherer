import { connect } from "react-redux";

import { decrement, increment, incrementAsync } from "@src/actions";
import Counter from "@src/components/Counter";
import { State } from "@src/types";

const mapStateToProps = (state: State) => ({ value: state.counters.value });

const mapDispatchToProps = (dispatch: any) => ({
  onDecrementClick: () => dispatch(decrement()),
  onIncrementClick: () => dispatch(increment()),
  onIncrementClickAsync: () => dispatch(incrementAsync())
});

const ContainedCounter = connect(mapStateToProps, mapDispatchToProps)(Counter);

export default ContainedCounter;
