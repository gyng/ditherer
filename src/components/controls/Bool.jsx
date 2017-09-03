// @flow

import React from "react";

const Bool = (props: any) => {
  return (
    <div>
      {props.name}
      <input type="checkbox" checked={props.value} />
      {props.value}
    </div>
  );
};

export default Bool;
