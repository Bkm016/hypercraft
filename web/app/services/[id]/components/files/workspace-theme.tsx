"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { RiCheckLine, RiPaletteLine } from "@remixicon/react";
import * as Dropdown from "@/components/ui/dropdown";
import * as Tooltip from "@/components/ui/tooltip";
import { cn } from "@/utils/cn";

/**
 * 文件工作区主题：文件树与编辑器共用一套配色。
 * - auto：跟随界面亮 / 暗色，使用 Hypercraft 自定义 Ace 主题（颜色来自全局设计变量）
 * - 其他：Ace 内置主题，文件树按主题配色同步
 */
export type WorkspaceThemeId =
  | "auto"
  | "github_light_default"
  | "solarized_light"
  | "github_dark"
  | "one_dark"
  | "dracula"
  | "nord_dark"
  | "monokai"
  | "solarized_dark"
  | "tomorrow_night_eighties";

export interface WorkspaceTheme {
  id: WorkspaceThemeId;
  label: string;
  /** Ace 主题名（ace/theme/<name>） */
  ace: string;
  /** null = 跟随界面 */
  dark: boolean | null;
  /** 预览色块：[背景, 侧栏, 强调] */
  swatch: [string, string, string];
  vars: WorkspaceVars;
}

interface WorkspaceVars {
  /** 编辑区 / 文件树背景 */
  bg: string;
  /** 侧栏、标题栏、状态栏背景 */
  panel: string;
  fg: string;
  sub: string;
  muted: string;
  border: string;
  hover: string;
  selected: string;
  accent: string;
  onAccent: string;
  /** 文件夹图标颜色 */
  folder: string;
  /** 可编辑文件图标颜色 */
  code: string;
}

const AUTO_VARS: WorkspaceVars = {
  bg: "var(--bg-white-0)",
  panel: "var(--bg-white-0)",
  fg: "var(--text-strong-950)",
  sub: "var(--text-sub-600)",
  muted: "var(--text-soft-400)",
  border: "var(--stroke-soft-200)",
  hover: "var(--overlay-hover)",
  selected: "var(--primary-alpha-10)",
  accent: "var(--primary-base)",
  onAccent: "var(--text-white-0)",
  folder: "var(--away-base)",
  code: "var(--information-base)",
};

export const WORKSPACE_THEMES: WorkspaceTheme[] = [
  { id: "auto", label: "跟随界面", ace: "hypercraft", dark: null, swatch: ["#ffffff", "#17171a", "#171717"], vars: AUTO_VARS },
  {
    id: "github_light_default",
    label: "GitHub Light",
    ace: "github_light_default",
    dark: false,
    swatch: ["#ffffff", "#f6f8fa", "#0969da"],
    vars: {
      bg: "#ffffff", panel: "#f6f8fa", fg: "#1f2328", sub: "#424a53", muted: "#6e7781", border: "#d0d7de",
      hover: "rgba(208,215,222,0.32)", selected: "rgba(9,105,218,0.1)", accent: "#0969da", onAccent: "#ffffff",
      folder: "#54aeff", code: "#0969da",
    },
  },
  {
    id: "solarized_light",
    label: "Solarized Light",
    ace: "solarized_light",
    dark: false,
    swatch: ["#fdf6e3", "#eee8d5", "#268bd2"],
    vars: {
      bg: "#fdf6e3", panel: "#eee8d5", fg: "#586e75", sub: "#657b83", muted: "#93a1a1", border: "#ddd6c1",
      hover: "rgba(7,54,66,0.06)", selected: "rgba(38,139,210,0.15)", accent: "#268bd2", onAccent: "#fdf6e3",
      folder: "#b58900", code: "#268bd2",
    },
  },
  {
    id: "github_dark",
    label: "GitHub Dark",
    ace: "github_dark",
    dark: true,
    swatch: ["#24292e", "#1f2428", "#79b8ff"],
    vars: {
      bg: "#24292e", panel: "#1f2428", fg: "#e1e4e8", sub: "#b1bac4", muted: "#8b949e", border: "#1b1f23",
      hover: "rgba(255,255,255,0.05)", selected: "rgba(121,184,255,0.16)", accent: "#79b8ff", onAccent: "#0d1117",
      folder: "#e3b341", code: "#79b8ff",
    },
  },
  {
    id: "one_dark",
    label: "One Dark",
    ace: "one_dark",
    dark: true,
    swatch: ["#282c34", "#21252b", "#61afef"],
    vars: {
      bg: "#282c34", panel: "#21252b", fg: "#abb2bf", sub: "#9da5b4", muted: "#7f848e", border: "#181a1f",
      hover: "rgba(255,255,255,0.04)", selected: "#2c313a", accent: "#61afef", onAccent: "#1e2127",
      folder: "#e5c07b", code: "#61afef",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    ace: "dracula",
    dark: true,
    swatch: ["#282a36", "#21222c", "#bd93f9"],
    vars: {
      bg: "#282a36", panel: "#21222c", fg: "#f8f8f2", sub: "#d6d6cf", muted: "#6272a4", border: "#191a21",
      hover: "rgba(255,255,255,0.05)", selected: "#44475a", accent: "#bd93f9", onAccent: "#21222c",
      folder: "#f1fa8c", code: "#8be9fd",
    },
  },
  {
    id: "nord_dark",
    label: "Nord",
    ace: "nord_dark",
    dark: true,
    swatch: ["#2e3440", "#272c36", "#88c0d0"],
    vars: {
      bg: "#2e3440", panel: "#272c36", fg: "#d8dee9", sub: "#c0c8d6", muted: "#7b88a1", border: "#20242c",
      hover: "rgba(255,255,255,0.04)", selected: "#3b4252", accent: "#88c0d0", onAccent: "#2e3440",
      folder: "#ebcb8b", code: "#88c0d0",
    },
  },
  {
    id: "monokai",
    label: "Monokai",
    ace: "monokai",
    dark: true,
    swatch: ["#272822", "#1e1f1c", "#a6e22e"],
    vars: {
      bg: "#272822", panel: "#1e1f1c", fg: "#f8f8f2", sub: "#cfcfc2", muted: "#90908a", border: "#141411",
      hover: "rgba(255,255,255,0.05)", selected: "#414339", accent: "#a6e22e", onAccent: "#1e1f1c",
      folder: "#e6db74", code: "#66d9ef",
    },
  },
  {
    id: "solarized_dark",
    label: "Solarized Dark",
    ace: "solarized_dark",
    dark: true,
    swatch: ["#002b36", "#00212b", "#268bd2"],
    vars: {
      bg: "#002b36", panel: "#00212b", fg: "#93a1a1", sub: "#839496", muted: "#586e75", border: "#001a21",
      hover: "rgba(255,255,255,0.04)", selected: "#073642", accent: "#268bd2", onAccent: "#fdf6e3",
      folder: "#b58900", code: "#2aa198",
    },
  },
  {
    id: "tomorrow_night_eighties",
    label: "Tomorrow Night",
    ace: "tomorrow_night_eighties",
    dark: true,
    swatch: ["#2d2d2d", "#262626", "#6699cc"],
    vars: {
      bg: "#2d2d2d", panel: "#262626", fg: "#cccccc", sub: "#b4b4b4", muted: "#999999", border: "#1f1f1f",
      hover: "rgba(255,255,255,0.04)", selected: "#393939", accent: "#6699cc", onAccent: "#1f1f1f",
      folder: "#ffcc66", code: "#6699cc",
    },
  },
];

const STORAGE_KEY = "hc.files.theme";
const EVENT = "hc:files-theme";

export function getWorkspaceTheme(id: WorkspaceThemeId): WorkspaceTheme {
  return WORKSPACE_THEMES.find((t) => t.id === id) ?? WORKSPACE_THEMES[0];
}

/** 主题选择持久化到 localStorage，同页多个实例通过自定义事件同步 */
export function useWorkspaceTheme() {
  const [id, setId] = useState<WorkspaceThemeId>("auto");

  useEffect(() => {
    const read = () => {
      const v = window.localStorage.getItem(STORAGE_KEY) as WorkspaceThemeId | null;
      setId(v && WORKSPACE_THEMES.some((t) => t.id === v) ? v : "auto");
    };
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  const set = useCallback((next: WorkspaceThemeId) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { theme: getWorkspaceTheme(id), setTheme: set };
}

/** 把主题写成 CSS 变量，供文件树 / 编辑器 / 状态栏引用 */
export function workspaceStyle(theme: WorkspaceTheme): CSSProperties {
  const v = theme.vars;
  return {
    "--ws-bg": v.bg,
    "--ws-panel": v.panel,
    "--ws-fg": v.fg,
    "--ws-sub": v.sub,
    "--ws-muted": v.muted,
    "--ws-border": v.border,
    "--ws-hover": v.hover,
    "--ws-selected": v.selected,
    "--ws-accent": v.accent,
    "--ws-on-accent": v.onAccent,
    "--ws-folder": v.folder,
    "--ws-code": v.code,
    colorScheme: theme.dark === null ? undefined : theme.dark ? "dark" : "light",
  } as CSSProperties;
}

function Swatch({ colors }: { colors: [string, string, string] }) {
  return (
    <span className="flex h-4 w-6 shrink-0 overflow-hidden rounded-[4px] ring-1 ring-inset ring-black/10">
      <span className="flex-1" style={{ background: colors[1] }} />
      <span className="flex flex-[1.4] items-center justify-center" style={{ background: colors[0] }}>
        <span className="size-1.5 rounded-full" style={{ background: colors[2] }} />
      </span>
    </span>
  );
}

/** 工作区主题选择按钮（下拉菜单） */
export function WorkspaceThemePicker({ className }: { className?: string }) {
  const { theme, setTheme } = useWorkspaceTheme();
  const light = WORKSPACE_THEMES.filter((t) => t.dark === false);
  const dark = WORKSPACE_THEMES.filter((t) => t.dark === true);

  const Item = ({ t }: { t: WorkspaceTheme }) => (
    <Dropdown.Item onSelect={() => setTheme(t.id)} className="gap-2.5 py-1.5">
      {t.id === "auto" ? (
        <span className="flex h-4 w-6 shrink-0 overflow-hidden rounded-[4px] ring-1 ring-inset ring-black/10">
          <span className="flex-1 bg-white" />
          <span className="flex-1 bg-[#17171a]" />
        </span>
      ) : (
        <Swatch colors={t.swatch} />
      )}
      <span className="flex-1">{t.label}</span>
      {theme.id === t.id && <RiCheckLine className="size-4 text-text-sub-600" />}
    </Dropdown.Item>
  );

  return (
    <Dropdown.Root modal={false}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              aria-label="编辑器主题"
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--ws-muted)] transition-colors",
                "hover:bg-[var(--ws-hover)] hover:text-[var(--ws-fg)] data-[state=open]:bg-[var(--ws-hover)] data-[state=open]:text-[var(--ws-fg)]",
                className,
              )}
            >
              <RiPaletteLine className="size-4" />
            </button>
          </Dropdown.Trigger>
        </Tooltip.Trigger>
        <Tooltip.Content>编辑器主题 · {theme.label}</Tooltip.Content>
      </Tooltip.Root>
      <Dropdown.Content align="end" className="w-56">
        <Item t={WORKSPACE_THEMES[0]} />
        <Dropdown.Separator className="-mx-1.5 h-px bg-stroke-soft-200" />
        <Dropdown.Label>浅色</Dropdown.Label>
        {light.map((t) => (
          <Item key={t.id} t={t} />
        ))}
        <Dropdown.Label>深色</Dropdown.Label>
        {dark.map((t) => (
          <Item key={t.id} t={t} />
        ))}
      </Dropdown.Content>
    </Dropdown.Root>
  );
}
