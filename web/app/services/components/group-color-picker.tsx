"use client";

import { RiCheckLine } from "@remixicon/react";
import { parseColor } from "react-aria-components";
import * as ColorPickerPrimitive from "@/components/ui/color-picker";
import * as Popover from "@/components/ui/popover";
import { PRESET_COLORS } from "./tag-utils";

export { PRESET_COLORS };

export interface GroupColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export function GroupColorPicker({ value, onChange }: GroupColorPickerProps) {
  const isPresetColor = PRESET_COLORS.includes(value);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* 预设颜色 */}
      {PRESET_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className={`size-6 rounded-full transition-all flex items-center justify-center ${
            value === color
              ? "ring-2 ring-offset-2 ring-primary-base"
              : "hover:scale-110"
          }`}
          style={{ backgroundColor: color }}
        >
          {value === color && <RiCheckLine className="size-3.5 text-white" />}
        </button>
      ))}

      {/* 自定义颜色选择器 */}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={`size-6 rounded-full transition-all flex items-center justify-center border-2 border-dashed border-stroke-soft-200 hover:border-primary-base ${
              !isPresetColor ? "ring-2 ring-offset-2 ring-primary-base" : ""
            }`}
            style={!isPresetColor ? { backgroundColor: value, borderStyle: "solid" } : undefined}
          >
            {isPresetColor ? (
              <span className="text-xs text-text-soft-400">+</span>
            ) : (
              <RiCheckLine className="size-3.5 text-white" />
            )}
          </button>
        </Popover.Trigger>
        <Popover.Content align="start" className="w-[280px] p-3">
          <ColorPickerPrimitive.Root
            value={parseColor(value).toString("hsla")}
            onChange={(color) => onChange(color.toString("hex"))}
          >
            <div className="space-y-3">
              {/* 颜色区域 */}
              <ColorPickerPrimitive.Area className="h-40">
                <ColorPickerPrimitive.Thumb />
              </ColorPickerPrimitive.Area>

              {/* 色相滑块 */}
              <ColorPickerPrimitive.Slider channel="hue">
                <ColorPickerPrimitive.SliderTrack>
                  <ColorPickerPrimitive.Thumb />
                </ColorPickerPrimitive.SliderTrack>
              </ColorPickerPrimitive.Slider>

              {/* 预设颜色快捷选择 */}
              <ColorPickerPrimitive.SwatchPicker className="gap-1.5">
                {PRESET_COLORS.map((color) => (
                  <ColorPickerPrimitive.SwatchPickerItem key={color} color={color}>
                    <ColorPickerPrimitive.Swatch />
                  </ColorPickerPrimitive.SwatchPickerItem>
                ))}
              </ColorPickerPrimitive.SwatchPicker>
            </div>
          </ColorPickerPrimitive.Root>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}
