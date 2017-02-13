// @flow

import { connect } from 'react-redux';
import { increment, decrement } from 'actions';
import Counter from 'components/Counter';
import type { State } from 'types';

const mapStateToProps = (state: State) => ({ value: state.counters.value });

const mapDispatchToProps = (dispatch: Dispatch) => ({
  onIncrementClick: () => dispatch(increment()),
  onDecrementClick: () => dispatch(decrement()),
});

const ContainedCounter = connect(
  mapStateToProps,
  mapDispatchToProps,
)(Counter);

export default ContainedCounter;
