/* @flow */

import React from 'react';
import { render } from 'react-dom';

import App from './components/App/App';
import s from './styles/style.scss';

render(<App className={s.app} />, document.getElementById('app'));
