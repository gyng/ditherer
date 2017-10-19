import * as React from "react";

const s = require("./styles.scss");

const Echo = (props: { text: string }) => (
  <p className={s.text}>{props.text}</p>
);

export default Echo;
