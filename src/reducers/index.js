// @flow

import { combineReducers } from 'redux';

import counters from './counters';

const combinedReducers = combineReducers({
  counters,
});

export default combinedReducers;
