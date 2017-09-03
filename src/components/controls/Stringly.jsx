// @flow

import React from "react";

const Stringly = (props: any) => {
  return (
    <div>
      {props.name}
      <input type="text" value={props.value} />
    </div>
  );
};

export default Stringly;
