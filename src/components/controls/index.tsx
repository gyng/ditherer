import React from "react";
import type {
  ActionOptionDefinition,
  EnumOptionDefinition,
  FilterOptionDefinitions,
  FilterOptionValues,
  PaletteOptionDefinition,
  RangeOptionDefinition,
} from "filters/types";
import type { NestedControlsProps, PaletteValue } from "./types";

import {
  ACTION,
  BOOL,
  COLOR,
  RANGE,
  ENUM,
  COLOR_ARRAY,
  STRING,
  TEXT,
  PALETTE,
  CURVE
} from "constants/controlTypes";

import { useFilter } from "context/useFilter";

import Enum from "./Enum";
import Palette from "./Palette";
import Bool from "./Bool";
import Range from "./Range";
import Stringly from "./Stringly";
import Textly from "./Textly";
import ColorArray from "./ColorArray";
import ColorPicker from "./ColorPicker";
import Curve from "./Curve";

import s from "./styles.module.css";

const Controls = (props: NestedControlsProps) => {
  const { state, actions } = useFilter();
  // Allow prop overrides for nested Controls (e.g., Palette sub-options)
  const filter = state.selected?.filter;
  const optionTypes: FilterOptionDefinitions = props.optionTypes || filter?.optionTypes || {};
  const options: FilterOptionValues = props.options || filter?.options || {};
  const inputCanvas = props.inputCanvas;
  const onSetFilterOption = props.onSetFilterOption || actions.setFilterOption;
  const onSetPaletteOption = props.onSetPaletteOption || actions.setFilterPaletteOption;
  const onAddPaletteColor: (color: number[]) => void = props.onAddPaletteColor || actions.addPaletteColor;
  const onSaveColorPalette: (name: string, colors: number[][]) => void =
    props.onSaveColorPalette || actions.saveCurrentColorPalette;
  const onDeleteColorPalette: (name: string) => void =
    props.onDeleteColorPalette || actions.deleteCurrentColorPalette;

  return (
    <div className={s.controls}>
      {Object.entries(optionTypes).filter(([, oType]) => {
        // Optional visibility predicate — option types may declare a
        // visibleWhen(options) callback to hide controls that are no-ops
        // given the current option values (e.g. rowAlternation when the
        // scan order isn't row-major).
        const vw = oType.visibleWhen;
        return typeof vw !== "function" || vw(options);
      }).map(e => {
        const [name, oType] = e;
        // Coalesce missing values to the optionType's default so controls
        // never flip from uncontrolled (undefined value) to controlled
        // (defined value) on first interaction — that triggers React's
        // controlled-input warning. Happens easily when the user replaces
        // one filter with another that has a different option shape.
        const value = options[name] !== undefined ? options[name] : oType.default;

        switch (oType.type) {
          case ACTION:
            {
              const actionType = oType as ActionOptionDefinition;
            return (
              <button
                key={name}
                onClick={() => {
                  actionType.action(actions, inputCanvas ?? null, state.selected?.filter?.func, options);
                }}
              >
                {actionType.label || name}
              </button>
            );
            }
          case RANGE:
            {
              const rangeType = oType as RangeOptionDefinition;
            return (
              <Range
                key={name}
                name={name}
                types={{ label: rangeType.label, desc: rangeType.desc, range: rangeType.range }}
                value={typeof value === "number" ? value : Number(value ?? rangeType.default ?? 0)}
                step={rangeType.step}
                onSetFilterOption={onSetFilterOption}
              />
            );
            }
          case PALETTE:
            {
              const paletteType = oType as PaletteOptionDefinition;
            return (
              <Palette
                key={name}
                name={name}
                types={{ label: paletteType.label, desc: paletteType.desc }}
                value={value as PaletteValue}
                paletteOptions={(value as PaletteValue | undefined)?.options}
                onAddPaletteColor={onAddPaletteColor}
                onSetFilterOption={onSetFilterOption}
                onSetPaletteOption={onSetPaletteOption}
                onSaveColorPalette={onSaveColorPalette}
                onDeleteColorPalette={onDeleteColorPalette}
                inputCanvas={inputCanvas}
              />
            );
            }
          case COLOR_ARRAY:
            return (
              <ColorArray
                key={name}
                name={name}
                value={Array.isArray(options.colors) ? (options.colors as number[][]) : []}
                onAddPaletteColor={onAddPaletteColor as (color: number[]) => void}
                onSetFilterOption={onSetFilterOption}
                onSetPaletteOption={onSetPaletteOption}
                onSaveColorPalette={onSaveColorPalette as (name: string, colors: number[][]) => void}
                onDeleteColorPalette={onDeleteColorPalette}
                inputCanvas={inputCanvas}
              />
            );
          case COLOR:
            return (
              <ColorPicker
                key={name}
                name={name}
                value={typeof value === "string" || Array.isArray(value) ? value : String(value ?? "")}
                onSetFilterOption={onSetFilterOption}
              />
            );
          case STRING:
            return (
              <Stringly
                key={name}
                name={name}
                types={{ label: oType.label, desc: oType.desc }}
                value={typeof value === "string" ? value : String(value ?? "")}
                onSetFilterOption={onSetFilterOption}
              />
            );
          case TEXT:
            return (
              <Textly
                key={name}
                name={name}
                types={{ label: oType.label, desc: oType.desc }}
                value={typeof value === "string" ? value : String(value ?? "")}
                onSetFilterOption={onSetFilterOption}
              />
            );
          case CURVE:
            return (
              <Curve
                key={name}
                name={name}
                types={oType}
                value={typeof value === "string" ? value : ""}
                onSetFilterOption={onSetFilterOption}
              />
            );
          case BOOL:
            return (
              <Bool
                key={name}
                name={name}
                types={{ label: oType.label, desc: oType.desc }}
                value={Boolean(value)}
                onSetFilterOption={onSetFilterOption}
              />
            );
          case ENUM:
            {
              const enumType = oType as EnumOptionDefinition;
            return (
              <Enum
                key={name}
                name={name}
                types={{ label: enumType.label, desc: enumType.desc, options: enumType.options }}
                value={typeof value === "number" || typeof value === "string" ? value : String(value ?? "")}
                onSetFilterOption={onSetFilterOption}
              />
            );
            }
          default:
            return <div>Unknown setting type</div>;
        }
      })}
    </div>
  );
};

export default Controls;
