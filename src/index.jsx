// @flow
/* eslint-disable no-underscore-dangle */

import React from 'react';
import { render } from 'react-dom';
import { createStore, combineReducers } from 'redux';
import { Provider } from 'react-redux';
import { Router, Route, browserHistory } from 'react-router';
import { syncHistoryWithStore, routerReducer } from 'react-router-redux';

import App from 'components/App';
import Counter from 'containers/Counter';
import reducers from 'reducers';

import s from 'styles/style.scss';

const store = createStore(
  combineReducers({
    routing: routerReducer,
    ...reducers,
  }),
  // Redux devtools are still enabled in production!
  window.__REDUX_DEVTOOLS_EXTENSION__ && window.__REDUX_DEVTOOLS_EXTENSION__(),
);

const history = syncHistoryWithStore(browserHistory, store);

render(
  <Provider store={store}>
    <Router history={history}>
      <Route path="/" component={App} className={s.app}>
        <Route path="/nested" component={Counter} />
      </Route>
    </Router>
  </Provider>,
  document.getElementById('root'),
);
