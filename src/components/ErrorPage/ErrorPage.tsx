import * as React from "react";
import { Link } from "react-router-dom";

import { config } from "@cfg";

export interface IErrorPageProps {
  code?: string;
  message?: string;
}

// Note that for 404s, this error page will only show up if your
// server is configured to fallback to root (ie. `/`). Otherwise,
// your server's 404 will be used instead.
export class ErrorPage extends React.Component<IErrorPageProps, {}> {
  public static defaultProps: Partial<IErrorPageProps> = {
    code: "?",
    message: "An error has occurred."
  };

  public render() {
    return (
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          justifyContent: "center",
          width: "100vw"
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
