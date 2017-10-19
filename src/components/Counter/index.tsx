import * as React from "react";

export interface CounterProps {
  value: number;
  onIncrementClick: () => void;
  onIncrementClickAsync: () => void;
  onDecrementClick: () => void;
}

export default class Counter extends React.Component<CounterProps, {}> {
  public render() {
    return (
      <div>
        <div className="value">{this.props.value}</div>
        <button className="increment" onClick={this.props.onIncrementClick}>
          INCREMENT
        </button>
        <button className="decrement" onClick={this.props.onDecrementClick}>
          DECREMENT
        </button>
        <button
          className="increment"
          onClick={this.props.onIncrementClickAsync}
        >
          INCREMENT AFTER 1 SECOND
        </button>
      </div>
    );
  }
}
