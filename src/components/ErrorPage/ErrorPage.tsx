import * as React from "react";
import { Link } from "react-router-dom";

export interface IErrorPageProps {
  code?: string;
  message?: string;
}

const defaultErrorPageProps = {
  code: "?",
  message: "An error has occurred."
};

export const ErrorPage = (props: IErrorPageProps = defaultErrorPageProps) => (
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
    <h1>{props.code}</h1>
    <strong>{props.message}</strong>
    <p style={{ textAlign: "center" }}>
      Change me in <code>components/ErrorPage/ErrorPage.tsx</code>. <br />
      The 404 route is defined in <code>index.tsx</code>.
    </p>

    <Link to="/">Back to index</Link>
  </div>
);
