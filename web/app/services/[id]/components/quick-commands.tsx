"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  RiAddLine,
  RiCommandLine,
  RiDeleteBinLine,
  RiEditLine,
  RiArrowLeftLine,
  RiSearchLine,
  RiCloseLine,
  RiCheckLine,
} from "@remixicon/react";
import { parseColor } from "react-aria-components";
import * as Popover from "@/components/ui/popover";
import * as Tooltip from "@/components/ui/tooltip";
import * as CompactButton from "@/components/ui/compact-button";
import * as Button from "@/components/ui/button";
import * as Input from "@/components/ui/input";
import * as ColorPickerPrimitive from "@/components/ui/color-picker";
import { PRESET_COLORS } from "../../components/tag-utils";

// 快捷指令数据结构
export interface QuickCommand {
  id: string;
  name: string;
  command: string;
  color: string;
}

const STORAGE_KEY_PREFIX = "hypercraft-quick-commands-";

// 从 localStorage 加载指令
function loadCommands(serviceId: string): QuickCommand[] {
  if (typeof window === "undefined") return [];
  const saved = localStorage.getItem(STORAGE_KEY_PREFIX + serviceId);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // 兼容旧数据，添加默认颜色
      return parsed.map((cmd: QuickCommand) => ({
        ...cmd,
        color: cmd.color || PRESET_COLORS[0],
      }));
    } catch {
      return [];
    }
  }
  return [];
}

// 保存指令到 localStorage
function saveCommands(serviceId: string, commands: QuickCommand[]) {
  localStorage.setItem(STORAGE_KEY_PREFIX + serviceId, JSON.stringify(commands));
}

type ViewMode = "list" | "create" | "edit";

interface QuickCommandsProps {
  serviceId: string;
  onSend: (command: string) => void;
}

export function QuickCommands({ serviceId, onSend }: QuickCommandsProps) {
  const [open, setOpen] = useState(false);
  const [commands, setCommands] = useState<QuickCommand[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // 表单状态
  const [formName, setFormName] = useState("");
  const [formCommand, setFormCommand] = useState("");
  const [formColor, setFormColor] = useState(PRESET_COLORS[0]);

  const inputRef = useRef<HTMLInputElement>(null);
  const formInputRef = useRef<HTMLInputElement>(null);

  // 加载指令
  useEffect(() => {
    setCommands(loadCommands(serviceId));
  }, [serviceId]);

  // 保存指令
  const updateCommands = useCallback((newCommands: QuickCommand[]) => {
    setCommands(newCommands);
    saveCommands(serviceId, newCommands);
  }, [serviceId]);

  // 打开时重置状态
  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setViewMode("list");
      setSearchQuery("");
      setEditingId(null);
      setFormName("");
      setFormCommand("");
      setFormColor(PRESET_COLORS[0]);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  // 发送指令（不关闭弹窗）
  const handleSend = useCallback(
    (command: string) => {
      onSend(command + "\n");
    },
    [onSend]
  );

  // 切换到创建视图
  const switchToCreate = () => {
    setFormName("");
    setFormCommand("");
    setFormColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
    setEditingId(null);
    setViewMode("create");
    setTimeout(() => formInputRef.current?.focus(), 100);
  };

  // 切换到编辑视图
  const switchToEdit = (cmd: QuickCommand) => {
    setFormName(cmd.name);
    setFormCommand(cmd.command);
    setFormColor(cmd.color);
    setEditingId(cmd.id);
    setViewMode("edit");
    setTimeout(() => formInputRef.current?.focus(), 100);
  };

  // 返回列表视图
  const switchToList = () => {
    setViewMode("list");
    setSearchQuery("");
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // 保存（创建/编辑）
  const handleSave = () => {
    if (!formName.trim() || !formCommand.trim()) return;

    if (viewMode === "create") {
      const newCmd: QuickCommand = {
        id: Date.now().toString(),
        name: formName.trim(),
        command: formCommand.trim(),
        color: formColor,
      };
      updateCommands([...commands, newCmd]);
    } else if (viewMode === "edit" && editingId) {
      updateCommands(
        commands.map((cmd) =>
          cmd.id === editingId
            ? { ...cmd, name: formName.trim(), command: formCommand.trim(), color: formColor }
            : cmd
        )
      );
    }

    switchToList();
  };

  // 删除指令
  const handleDelete = (id: string) => {
    updateCommands(commands.filter((cmd) => cmd.id !== id));
  };

  // 过滤指令
  const filteredCommands = commands.filter(
    (cmd) =>
      !searchQuery ||
      cmd.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cmd.command.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const canSubmit = formName.trim() && formCommand.trim();

  return (
    <Popover.Root open={open} onOpenChange={handleOpen}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Popover.Trigger asChild>
            <CompactButton.Root
              variant="ghost"
              className="text-neutral-500 hover:bg-white/10 hover:text-neutral-300"
            >
              <CompactButton.Icon as={RiCommandLine} />
            </CompactButton.Root>
          </Popover.Trigger>
        </Tooltip.Trigger>
        <Tooltip.Content>快捷指令</Tooltip.Content>
      </Tooltip.Root>

      <Popover.Content align="end" className="w-[320px] p-0" showArrow={false}>
        {viewMode === "list" ? (
          <>
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-stroke-soft-200 px-4 py-3">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary-alpha-10">
                <RiCommandLine className="size-4 text-primary-base" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium text-text-strong-950">快捷指令</h3>
                <p className="text-xs text-text-sub-600">{commands.length} 个指令</p>
              </div>
              <Button.Root size="xsmall" variant="neutral" mode="ghost" onClick={switchToCreate}>
                <Button.Icon as={RiAddLine} />
              </Button.Root>
            </div>

            {/* 搜索框 */}
            <div className="border-b border-stroke-soft-200 p-3">
              <Input.Root size="small">
                <Input.Wrapper>
                  <Input.Icon as={RiSearchLine} />
                  <Input.Input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索指令..."
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="shrink-0 text-text-soft-400 hover:text-text-sub-600"
                    >
                      <RiCloseLine className="size-4" />
                    </button>
                  )}
                </Input.Wrapper>
              </Input.Root>
            </div>

            {/* 指令列表 */}
            <div className="max-h-72 overflow-y-auto p-2">
              {filteredCommands.length > 0 ? (
                <div className="space-y-0.5">
                  {filteredCommands.map((cmd) => (
                    <div
                      key={cmd.id}
                      className="group flex items-center gap-2 rounded-lg px-2 py-2 transition-all hover:bg-bg-soft-200"
                    >
                      {/* 点击发送 */}
                      <button
                        onClick={() => handleSend(cmd.command)}
                        className="flex flex-1 items-center gap-3 text-left"
                      >
                        {/* 颜色圆点 */}
                        <span
                          className="size-3 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                          style={{ backgroundColor: cmd.color }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-text-strong-950">{cmd.name}</div>
                          <div className="truncate font-mono text-xs text-text-soft-400">
                            {cmd.command}
                          </div>
                        </div>
                      </button>

                      {/* 操作按钮 */}
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                        <button
                          onClick={() => switchToEdit(cmd)}
                          className="rounded p-1.5 text-text-soft-400 transition hover:bg-bg-weak-50 hover:text-text-sub-600"
                        >
                          <RiEditLine className="size-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(cmd.id)}
                          className="rounded p-1.5 text-text-soft-400 transition hover:bg-error-lighter hover:text-error-base"
                        >
                          <RiDeleteBinLine className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : searchQuery ? (
                <div className="py-8 text-center text-sm text-text-soft-400">
                  没有找到 &quot;{searchQuery}&quot;
                </div>
              ) : (
                <div className="py-8 text-center">
                  <RiCommandLine className="mx-auto size-8 text-text-disabled-300" />
                  <p className="mt-2 text-sm text-text-soft-400">暂无快捷指令</p>
                  <button
                    onClick={switchToCreate}
                    className="mt-2 text-xs text-primary-base hover:underline"
                  >
                    添加第一个指令
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-stroke-soft-200 px-4 py-2">
              <p className="text-center text-xs text-text-soft-400">点击指令发送到终端</p>
            </div>
          </>
        ) : (
          <>
            {/* 创建/编辑视图 Header */}
            <div className="flex items-center gap-2 border-b border-stroke-soft-200 px-4 py-3">
              <button
                type="button"
                onClick={switchToList}
                className="flex size-8 items-center justify-center rounded-lg text-text-sub-600 hover:bg-bg-weak-50"
              >
                <RiArrowLeftLine className="size-4" />
              </button>
              <div>
                <h3 className="text-sm font-medium text-text-strong-950">
                  {viewMode === "create" ? "新建指令" : "编辑指令"}
                </h3>
                <p className="text-xs text-text-sub-600">
                  {viewMode === "create" ? "创建一个快捷指令" : "修改指令内容"}
                </p>
              </div>
            </div>

            {/* 表单 */}
            <div className="space-y-4 p-4">
              {/* 名称 */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-strong-950">
                  名称 <span className="text-error-base">*</span>
                </label>
                <Input.Root size="small">
                  <Input.Wrapper>
                    <Input.Input
                      ref={formInputRef}
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="查看 TPS"
                    />
                  </Input.Wrapper>
                </Input.Root>
              </div>

              {/* 命令 */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-strong-950">
                  命令 <span className="text-error-base">*</span>
                </label>
                <Input.Root size="small">
                  <Input.Wrapper>
                    <Input.Input
                      type="text"
                      value={formCommand}
                      onChange={(e) => setFormCommand(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canSubmit) {
                          e.preventDefault();
                          handleSave();
                        }
                      }}
                      placeholder="tps"
                      className="font-mono"
                    />
                  </Input.Wrapper>
                </Input.Root>
              </div>

              {/* 颜色 */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-strong-950">颜色</label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* 预设颜色 */}
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setFormColor(color)}
                      className={`size-6 rounded-full transition-all flex items-center justify-center ${
                        formColor === color
                          ? "ring-2 ring-offset-2 ring-primary-base"
                          : "hover:scale-110"
                      }`}
                      style={{ backgroundColor: color }}
                    >
                      {formColor === color && <RiCheckLine className="size-3.5 text-white" />}
                    </button>
                  ))}

                  {/* 自定义颜色选择器 */}
                  <Popover.Root>
                    <Popover.Trigger asChild>
                      <button
                        type="button"
                        className={`size-6 rounded-full transition-all flex items-center justify-center border-2 border-dashed border-stroke-soft-200 hover:border-primary-base ${
                          !PRESET_COLORS.includes(formColor) ? "ring-2 ring-offset-2 ring-primary-base" : ""
                        }`}
                        style={!PRESET_COLORS.includes(formColor) ? { backgroundColor: formColor, borderStyle: "solid" } : undefined}
                      >
                        {PRESET_COLORS.includes(formColor) ? (
                          <span className="text-xs text-text-soft-400">+</span>
                        ) : (
                          <RiCheckLine className="size-3.5 text-white" />
                        )}
                      </button>
                    </Popover.Trigger>
                    <Popover.Content align="start" className="w-[280px] p-3">
                      <ColorPickerPrimitive.Root
                        value={parseColor(formColor).toString("hsla")}
                        onChange={(color) => setFormColor(color.toString("hex"))}
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
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-stroke-soft-200 px-4 py-3">
              <Button.Root size="xsmall" variant="neutral" mode="ghost" onClick={switchToList}>
                取消
              </Button.Root>
              <Button.Root size="xsmall" onClick={handleSave} disabled={!canSubmit}>
                {viewMode === "create" ? "创建" : "保存"}
              </Button.Root>
            </div>
          </>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
