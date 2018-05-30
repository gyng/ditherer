import * as React from "react";

export interface ICounterProps {
  onDecrementClick: () => void;
  onIncrementClick: () => void;
  onIncrementClickAsync: () => void;
  value: number;
}

export default class Counter extends React.Component<ICounterProps, {}> {
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
        <div style={{ fontFamily: "monospace" }}>
          components/Counter/index.tsx
        </div>
        <div style={{ fontFamily: "monospace" }}>
          containers/Counter/index.tsx
        </div>
      </div>
    );
  }
}
