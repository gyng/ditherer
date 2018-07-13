import * as React from "react";

export interface ICounterProps {
  onDecrementClick: () => any;
  onIncrementClick: () => any;
  onIncrementClickAsync: () => any;
  value?: number;
}

export default class Counter extends React.Component<ICounterProps, {}> {
  public static defaultProps: Partial<ICounterProps> = { value: 0 };

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

        <a href="https://github.com/gyng/jsapp-boilerplate/blob/master/src/components/Counter/index.tsx">
          <div style={{ fontFamily: "monospace" }}>
            components/Counter/index.tsx
          </div>
        </a>
        <a href="https://github.com/gyng/jsapp-boilerplate/blob/master/src/containers/Counter.ts">
          <div style={{ fontFamily: "monospace" }}>
            containers/Counter/index.tsx
          </div>
        </a>

        <a href="https://github.com/gyng/jsapp-boilerplate/blob/master/src/reducers/counters.ts">
          <div style={{ fontFamily: "monospace" }}>reducers/counters.ts</div>
        </a>
      </div>
    );
  }
}
