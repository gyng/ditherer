// @flow

import React from "react";

import Controls from "components/controls";

import { paletteList } from "palettes";

const Palette = (props: any) => {
  return (
    <div>
      {props.name}

      <select value={props.value.name}>
        {paletteList.map(p =>
          <option key={p.name} name={p.name}>
            {p.name}
          </option>
        )}
      </select>

      <Controls optionTypes={props.value.optionTypes} options={props.options} />
    </div>
  );
};

export default Palette;
