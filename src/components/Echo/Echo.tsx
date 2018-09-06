import * as React from "react";

export const Echo = (props: { text?: string } = { text: "Default!" }) => (
  <p style={{ fontStyle: "italic" }}>{props.text}</p>
);
