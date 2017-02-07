/* eslint-disable react/prefer-stateless-function */

import React from 'react';

import Echo from '../Echo/Echo';
import hello from './hello.jpg';
import s from './styles.scss';

export default class App extends React.Component {
  render() {
    return (
      <div className={this.props.className}>
        <img className={s.robot} src={hello} alt="Cute robot?" />
        <Echo text="Hello, world!" />
        <Echo text="Find me in App.jsx!" />
      </div>
    );
  }
}

App.propTypes = {
  className: React.PropTypes.string,
};

App.defaultProps = {
  className: '',
};
