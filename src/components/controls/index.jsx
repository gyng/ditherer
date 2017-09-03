// @flow

import React from "react";

import {
  BOOL,
  RANGE,
  ENUM,
  COLOR_ARRAY,
  STRING,
  PALETTE
} from "constants/controlTypes";
import Enum from "./Enum";
import Palette from "./Palette";
import Bool from "./Bool";
import Range from "./Range";
import Stringly from "./Stringly";
import ColorArray from "./ColorArray";

const Controls = (props: any) => {
  return (
    <div>
      {Object.entries(props.optionTypes).map(e => {
        const [name, oType] = e;

        switch (oType.type) {
          case RANGE:
            return (
              <Range
                key={name}
                name={name}
                types={oType}
                value={props.options[name]}
              />
            );
          case PALETTE:
            return (
              <Palette
                key={name}
                name={name}
                types={oType}
                value={props.options[name]}
                options={props.options[name].options}
              />
            );
          case COLOR_ARRAY:
            return (
              <ColorArray key={name} name={name} value={props.options.colors} />
            );
          case STRING:
            return (
              <Stringly
                key={name}
                name={name}
                types={oType}
                value={props.options[name]}
              />
            );
          case BOOL:
            return (
              <Bool
                key={name}
                name={name}
                types={oType}
                value={props.options[name]}
              />
            );

          case ENUM:
            return (
              <Enum
                key={name}
                name={name}
                types={oType}
                value={props.options[name]}
              />
            );
          default:
            return <div>what</div>;
        }
      })}
    </div>
  );
};

export default Controls;
