// @flow

import React from 'react';

export default class Counter extends React.Component {
  render() {
    return (
      <div>
        <div className="value">{this.props.value}</div>
        <button className="increment" onClick={this.props.onIncrementClick}>INCREMENT</button>
        <button className="decrement" onClick={this.props.onDecrementClick}>DECREMENT</button>
      </div>
    );
  }
}

Counter.propTypes = {
  value: React.PropTypes.number.isRequired,
  onIncrementClick: React.PropTypes.func.isRequired,
  onDecrementClick: React.PropTypes.func.isRequired,
};
