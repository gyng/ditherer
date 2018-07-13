import * as React from "react";

const Echo = (props: { text?: string } = { text: "Default!" }) => (
  <p style={{ fontStyle: "italic" }}>{props.text}</p>
);

export default Echo;
