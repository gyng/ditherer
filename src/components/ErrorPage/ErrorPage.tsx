import * as React from "react";
import { Link } from "react-router-dom";

import { config } from "@cfg";

export interface ErrorPageProps {
  code?: string;
  message?: string;
}

// Note that for 404s, this error page will only show up if your
// server is configured to fallback to root (ie. `/`). Otherwise,
// your server's 404 will be used instead.
//
// The above only applies to browser history type. When using hash history,
// the Link component will handle the routing back to the index.
export class ErrorPage extends React.Component<ErrorPageProps, {}> {
  public static defaultProps: Partial<ErrorPageProps> = {
    code: "?",
    message: "An error has occurred.",
  };

  public render() {
    return (
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "center",
          width: "100vw",
        }}
      >
        <div style={{ fontSize: "25vh" }}>🔥</div>
        <h1>{this.props.code}</h1>
        <strong>{this.props.message}</strong>
        <p style={{ textAlign: "center" }}>
          Change me in <code>components/ErrorPage/ErrorPage.tsx</code>. <br />
          The 404 route is defined in <code>index.tsx</code>.
        </p>

        <Link to={config.url.basePath}>Back to index</Link>
      </div>
    );
  }
}
