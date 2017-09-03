// @flow

import React from "react";

const ColorArray = (props: any) =>
  <div style={{ display: "flex", flexDirection: "row" }}>
    {props.value.map(c =>
      <div
        style={{
          minHeight: "16px",
          minWidth: "16px",
          backgroundColor: `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`
        }}
      />
    )}
  </div>;

export default ColorArray;
