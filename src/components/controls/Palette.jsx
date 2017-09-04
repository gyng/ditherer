// @flow

import React from "react";

import Controls from "components/controls";

import { paletteList } from "palettes";

const Palette = (props: any) => {
  return (
    <div>
      {props.name}

      <select
        value={props.value.name}
        onChange={e => props.onSetFilterOption(props.name, e.target.value)}
      >
        {paletteList.map(p =>
          <option key={p.name} name={p.name}>
            {p.name}
          </option>
        )}
      </select>

      <Controls
        optionTypes={props.value.optionTypes}
        options={props.options}
        onSetPaletteOption={props.onSetPaletteOption}
        onSetFilterOption={props.onSetPaletteOption}
      />
    </div>
  );
};

export default Palette;
