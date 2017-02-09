// @flow
/* eslint-disable no-underscore-dangle */

import React from 'react';
import { render } from 'react-dom';
import { createStore, combineReducers } from 'redux';
import { Provider } from 'react-redux';
import { Router, Route, browserHistory } from 'react-router';
import { syncHistoryWithStore, routerReducer } from 'react-router-redux';
import App from 'components/App';
import reducers from 'reducers';

import s from './styles/style.scss';

const store = createStore(
  combineReducers({
    routing: routerReducer,
    ...reducers,
  }),
  window.__REDUX_DEVTOOLS_EXTENSION__ && window.__REDUX_DEVTOOLS_EXTENSION__(),
);

const history = syncHistoryWithStore(browserHistory, store);

render(
  <Provider store={store}>
    <Router history={history}>
      <Route path="/" component={App} className={s.app} />
    </Router>
  </Provider>,
  document.getElementById('root'),
);
