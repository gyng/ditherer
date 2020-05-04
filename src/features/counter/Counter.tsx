import classNames from "classnames";
import * as React from "react";

const styles = require("./counter.pcss");

export interface CounterProps {
  onDecrementClick: () => void;
  onIncrementClick: () => void;
  onIncrementClickAsync: () => void;
  onIncrementClickAsyncPromise: (url: string) => void;
  onIncrementClickAsyncAwait: (url: string) => void;
  value?: number;
}

export class Counter extends React.Component<CounterProps, {}> {
  public static defaultProps: Partial<CounterProps> = { value: 0 };

  public render() {
    return (
      <div className={styles.container}>
        <div className={classNames(styles.value, "value")}>
          {this.props.value}
        </div>

        <div>
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

          <button
            className="increment"
            onClick={() => {
              this.props.onIncrementClickAsyncPromise("/");
            }}
          >
            INCREMENT ASYNC/AWAIT
          </button>

          <button
            className="increment"
            onClick={() => {
              this.props.onIncrementClickAsyncPromise("www.example.invalidtld");
            }}
          >
            INCREMENT ASYNC PROMISE (404)
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
      </div>
    );
  }
}
