import * as React from "react";

const Echo = (props: { text: string }) => (
  <p style={{ fontStyle: "italic" }}>{props.text}</p>
);

export default Echo;
