import * as React from "react";
import styled from "react-emotion";

const EchoP = styled("p")`
  font-style: italic;
  text-align: center;
`;

const Echo = (props: { text: string }) => <EchoP>{props.text}</EchoP>;

export default Echo;
