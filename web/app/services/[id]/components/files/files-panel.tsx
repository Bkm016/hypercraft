"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTree } from "@headless-tree/react";
import {
  asyncDataLoaderFeature,
  dragAndDropFeature,
  hotkeysCoreFeature,
  renamingFeature,
  searchFeature,
  selectionFeature,
  type ItemInstance,
} from "@headless-tree/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiDownload2Line,
  RiDragDropLine,
  RiEditLine,
  RiFile3Line,
  RiFileAddLine,
  RiFileCodeLine,
  RiFolder3Fill,
  RiFolderAddLine,
  RiFolderOpenFill,
  RiFolderOpenLine,
  RiLinkM,
  RiLoader4Line,
  RiRefreshLine,
  RiSearchLine,
  RiUpload2Line,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import { notification } from "@/hooks/use-notification";
import { api, type ApiError, type FileEntry } from "@/lib/api";
import { FileDialog, type FileDialogState } from "./file-dialog";
import { FileEditor } from "./file-editor";
import { UploadQueue, useUploads, MAX_FILE_BYTES } from "./uploads";
import { useWorkspaceTheme, workspaceStyle, WorkspaceThemePicker } from "./workspace-theme";
import { IconButton, StatusBar, ToolbarDivider } from "./workspace-ui";

/** Headless Tree 的 item id 用 "/" + 相对路径，根为 "/" */
const ROOT_ID = "/";
const toPath = (id: string) => (id === ROOT_ID ? "" : id.slice(1));
const toId = (path: string) => `/${path}`;
const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

type Node = FileEntry & { loading?: boolean };

const ROOT_NODE: Node = { name: "", path: "", is_dir: true, is_symlink: false, size: 0, editable: false };

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function NodeIcon({ node, open }: { node: Node; open: boolean }) {
  if (node.is_dir) {
    const Icon = open ? RiFolderOpenFill : RiFolder3Fill;
    return <Icon className="size-4 shrink-0 text-[var(--ws-folder)]" />;
  }
  const Icon = node.editable ? RiFileCodeLine : RiFile3Line;
  return <Icon className={`size-4 shrink-0 ${node.editable ? "text-[var(--ws-code)]" : "text-[var(--ws-muted)]"}`} />;
}

export interface FilesPanelProps {
  serviceId: string;
  /** 是否有工作目录 */
  hasCwd: boolean;
  /** 是否可写（文件管理读写权限） */
  canWrite: boolean;
}

export function FilesPanel({ serviceId, hasCwd, canWrite }: FilesPanelProps) {
  // Headless Tree 的 tree / item 是可变实例，状态变化时引用不变；
  // React Compiler 的自动记忆化会让行不随展开/选中/重命名状态重渲染，这里退出编译器优化。
  "use no memo";
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FileDialogState>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [truncatedDirs, setTruncatedDirs] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const { theme } = useWorkspaceTheme();
  const dirtyRef = useRef(false);
  const setDirty = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);

  // 离开页面时提醒未保存
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const confirmLeave = () => !dirtyRef.current || window.confirm("当前文件有未保存的修改，确定放弃？");

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadDirRef = useRef("");
  const uploads = useUploads(serviceId, (dir) => {
    if (dir) tree.getItemInstance(toId(dir))?.expand();
    refreshDirs([dir]);
  });

  const download = async (node: Node) => {
    if (node.is_dir) return;
    if (node.size > MAX_FILE_BYTES) {
      notification({ status: "error", title: "文件超过 25 MB，无法下载" });
      return;
    }
    try {
      await api.downloadServiceFile(serviceId, node.path);
    } catch (err) {
      notification({ status: "error", title: (err as ApiError).message || "下载失败" });
    }
  };

  const pickUpload = (dir: string) => {
    uploadDirRef.current = dir;
    uploadInputRef.current?.click();
  };

  const openFile = (node: Node) => {
    if (node.is_dir) return;
    if (!node.editable) {
      notification({ status: "information", title: "仅支持在线查看 YAML / JSON / TOML，其他文件可下载" });
      return;
    }
    if (node.path === openPath) return;
    if (!confirmLeave()) return;
    setOpenPath(node.path);
  };

  const tree = useTree<Node>({
    rootItemId: ROOT_ID,
    getItemName: (item) => item.getItemData()?.name ?? "",
    isItemFolder: (item) => !!item.getItemData()?.is_dir,
    createLoadingItemData: () => ({ ...ROOT_NODE, name: "加载中…", is_dir: false, loading: true }),
    dataLoader: {
      // 子项数据由 getChildrenWithData 一并给出；这里只会在根节点或缓存失效时用到
      getItem: (id) => (id === ROOT_ID ? ROOT_NODE : { ...ROOT_NODE, name: toPath(id).split("/").pop() ?? "", path: toPath(id) }),
      getChildrenWithData: async (id) => {
        const dir = toPath(id);
        try {
          const res = await api.listServiceFiles(serviceId, dir);
          if (id === ROOT_ID) setRootError(null);
          setTruncatedDirs((prev) =>
            res.truncated ? [...new Set([...prev, dir])] : prev.filter((d) => d !== dir),
          );
          return res.entries.map((e) => ({ id: toId(e.path), data: e }));
        } catch (err) {
          const msg = (err as ApiError).message || "读取目录失败";
          if (id === ROOT_ID) setRootError(msg);
          else notification({ status: "error", title: msg });
          return [];
        }
      },
    },
    indent: 14,
    canReorder: false,
    canDrag: () => canWrite,
    canDrop: (_items, target) => canWrite && !!target.item.getItemData()?.is_dir,
    onDrop: async (items, target) => {
      const destDir = toPath(target.item.getId());
      const moving = items.map((i) => toPath(i.getId())).filter((p) => parentOf(p) !== destDir);
      if (!moving.length) return;
      for (const from of moving) {
        if (destDir === from || destDir.startsWith(`${from}/`)) {
          notification({ status: "error", title: "不能移动到自身内部" });
          return;
        }
      }
      const failures: string[] = [];
      for (const from of moving) {
        const to = joinPath(destDir, from.split("/").pop() ?? "");
        try {
          await api.renameServiceFile(serviceId, from, to);
          if (openPath === from) setOpenPath(to);
          else if (openPath?.startsWith(`${from}/`)) setOpenPath(to + openPath.slice(from.length));
        } catch (err) {
          failures.push((err as ApiError).message);
        }
      }
      if (failures.length) notification({ status: "error", title: failures[0] });
      await refreshDirs([destDir, ...moving.map(parentOf)]);
    },
    // 从桌面拖入文件：落在目录上传到该目录，落在文件上传到其所在目录
    canDropForeignDragObject: (dataTransfer) => canWrite && dataTransfer.types.includes("Files"),
    canDragForeignDragObjectOver: (dataTransfer) => canWrite && dataTransfer.types.includes("Files"),
    onDropForeignDragObject: (dataTransfer, target) => {
      const node = target.item.getItemData();
      const dir = target.item.getId() === ROOT_ID ? "" : node?.is_dir ? node.path : parentOf(node?.path ?? "");
      uploads.enqueue(dir, Array.from(dataTransfer.files));
    },
    canRename: () => canWrite,
    onRename: async (item, value) => {
      const from = toPath(item.getId());
      const name = value.trim();
      if (!name || name === item.getItemName()) return;
      await doRename(from, name);
    },
    // 单击 / Enter 触发；多选（Ctrl/Shift）时不打开
    onPrimaryAction: (item) => {
      const node = item.getItemData();
      if (node && !node.is_dir && tree.getSelectedItems().length <= 1) openFile(node);
    },
    hotkeys: {
      customDelete: {
        hotkey: "Delete",
        isEnabled: () => canWrite,
        handler: () => {
          const paths = tree.getSelectedItems().map((i) => toPath(i.getId()));
          if (paths.length) setDialog({ kind: "delete", paths });
        },
      },
    },
    features: [
      asyncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      renamingFeature,
      searchFeature,
      dragAndDropFeature,
    ],
  });

  /** 重新拉取若干目录（去重，只刷新已加载过的） */
  const refreshDirs = useCallback(
    async (dirs: string[]) => {
      const ids = [...new Set(dirs.map((d) => toId(d)))];
      await Promise.all(
        ids.map((id) => {
          const inst = id === ROOT_ID ? tree.getItemInstance(ROOT_ID) : tree.getItemInstance(id);
          return inst?.invalidateChildrenIds(true);
        }),
      );
    },
    [tree],
  );

  const refreshAll = async () => {
    const expanded = tree.getState().expandedItems ?? [];
    await refreshDirs(["", ...expanded.map(toPath)]);
  };

  const doRename = async (from: string, name: string) => {
    const to = joinPath(parentOf(from), name);
    try {
      await api.renameServiceFile(serviceId, from, to);
      if (openPath === from) setOpenPath(to);
      else if (openPath?.startsWith(`${from}/`)) setOpenPath(to + openPath.slice(from.length));
      await refreshDirs([parentOf(from)]);
      return undefined;
    } catch (err) {
      const msg = (err as ApiError).message || "重命名失败";
      notification({ status: "error", title: msg });
      return msg;
    }
  };

  /** 新建 / 重命名 / 删除时的目标目录：选中项是目录则在其内，否则在其所在目录 */
  const currentDir = () => {
    const focused = tree.getSelectedItems()[0] ?? tree.getFocusedItem();
    const node = focused?.getItemData();
    if (!node || focused.getId() === ROOT_ID) return "";
    return node.is_dir ? node.path : parentOf(node.path);
  };

  const handleDialogSubmit = async (state: NonNullable<FileDialogState>, name: string) => {
    try {
      if (state.kind === "create-file" || state.kind === "create-dir") {
        const path = joinPath(state.dir, name);
        await api.createServiceFile(serviceId, path, state.kind === "create-file" ? "file" : "dir");
        if (state.dir) tree.getItemInstance(toId(state.dir))?.expand();
        await refreshDirs([state.dir]);
        if (state.kind === "create-file" && confirmLeave()) setOpenPath(path);
      } else if (state.kind === "rename") {
        return await doRename(state.path, name);
      } else if (state.kind === "delete") {
        for (const p of state.paths) await api.deleteServiceFile(serviceId, p);
        if (openPath && state.paths.some((p) => openPath === p || openPath.startsWith(`${p}/`))) {
          dirtyRef.current = false;
          setOpenPath(null);
        }
        tree.setSelectedItems([]);
        await refreshDirs(state.paths.map(parentOf));
      }
      return undefined;
    } catch (err) {
      return (err as ApiError).message || "操作失败";
    }
  };

  const items = tree.getItems();
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 20,
  });

  if (!hasCwd) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-stroke-soft-200 bg-bg-white-0 p-10 text-center shadow-regular-xs">
        <div className="flex size-12 items-center justify-center rounded-full bg-bg-weak-50">
          <RiFolderOpenLine className="size-6 text-text-soft-400" />
        </div>
        <div className="text-sm font-medium text-text-strong-950">未配置工作目录</div>
        <div className="max-w-sm text-sm text-text-sub-600">在「编辑」中为服务设置工作目录后，即可在这里浏览、上传和编辑文件。</div>
      </div>
    );
  }

  const selected = tree.getSelectedItems();
  const singleSelected = selected.length === 1 ? selected[0].getItemData() : null;
  const searching = tree.isSearchOpen();
  const rootLoading = items.length === 0 && !!tree.getItemInstance(ROOT_ID)?.isLoading();
  const rootEmpty = items.length === 0 && !rootLoading && !rootError;

  const hasFiles = (e: React.DragEvent) => canWrite && e.dataTransfer.types.includes("Files");

  return (
    <div
      style={workspaceStyle(theme)}
      className={`${theme.dark === null ? "" : theme.dark ? "dark" : "light"} relative flex min-h-0 flex-1 overflow-hidden rounded-xl border border-stroke-soft-200 bg-[var(--ws-bg)] shadow-regular-xs`}
      // 桌面拖入时显示整体投放提示（真正的落点由行 / 空白区处理）
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={() => {
        dragDepth.current = 0;
        setDragOver(false);
      }}
    >
      {/* 左：文件树 */}
      <div
        className={`flex min-h-0 w-full flex-col border-r border-[var(--ws-border)] bg-[var(--ws-panel)] md:w-72 md:shrink-0 lg:w-80 ${
          openPath ? "hidden md:flex" : "flex"
        }`}
      >
        {/* 标题 + 操作 */}
        <div className="flex h-11 shrink-0 items-center gap-0.5 border-b border-[var(--ws-border)] pl-3 pr-1.5 md:pl-4">
          <span className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-[var(--ws-muted)]">
            文件
          </span>
          {canWrite && (
            <>
              <IconButton label="上传文件（也可直接拖入）" icon={RiUpload2Line} onClick={() => pickUpload(currentDir())} />
              <IconButton label="新建配置文件" icon={RiFileAddLine} onClick={() => setDialog({ kind: "create-file", dir: currentDir() })} />
              <IconButton label="新建文件夹" icon={RiFolderAddLine} onClick={() => setDialog({ kind: "create-dir", dir: currentDir() })} />
              <ToolbarDivider />
            </>
          )}
          <IconButton label="刷新" icon={RiRefreshLine} onClick={refreshAll} />
          <WorkspaceThemePicker />
        </div>

        {/* 搜索 */}
        <div className="shrink-0 px-2 pb-1 pt-2">
          <div
            className={`flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs transition-colors ${
              searching
                ? "bg-[var(--ws-bg)] ring-1 ring-[var(--ws-accent)]/50"
                : "bg-[var(--ws-hover)] hover:ring-1 hover:ring-[var(--ws-border)]"
            }`}
          >
            <RiSearchLine className="size-3.5 shrink-0 text-[var(--ws-muted)]" />
            {searching ? (
              <>
                <input
                  {...tree.getSearchInputElementProps()}
                  placeholder="在已展开的目录中查找"
                  className="min-w-0 flex-1 bg-transparent text-[var(--ws-fg)] outline-none placeholder:text-[var(--ws-muted)]"
                />
                <button
                  type="button"
                  aria-label="关闭搜索"
                  className="text-[var(--ws-muted)] hover:text-[var(--ws-fg)]"
                  onClick={() => tree.closeSearch()}
                >
                  <RiCloseLine className="size-3.5" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => tree.openSearch()}
                className="min-w-0 flex-1 truncate text-left text-[var(--ws-muted)]"
                title="在树中直接输入字符也可以查找"
              >
                查找文件
              </button>
            )}
          </div>
        </div>

        <input
          ref={uploadInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) uploads.enqueue(uploadDirRef.current, files);
          }}
        />
        {rootError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="text-sm text-[var(--ws-sub)]">{rootError}</div>
            <Button.Root size="xxsmall" variant="neutral" mode="stroke" onClick={refreshAll}>
              重试
            </Button.Root>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-2"
            // 拖到空白处 → 上传到根目录（行上的拖放由 Headless Tree 处理）
            onDragOver={(e) => {
              if (hasFiles(e)) e.preventDefault();
            }}
            onDrop={(e) => {
              if (!canWrite || !e.dataTransfer.files.length) return;
              if ((e.target as HTMLElement).closest("[role=treeitem]")) return;
              e.preventDefault();
              uploads.enqueue("", Array.from(e.dataTransfer.files));
            }}
          >
            <div
              {...tree.getContainerProps("服务文件")}
              className="relative outline-none"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((vi) => {
                const item = items[vi.index] as ItemInstance<Node> | undefined;
                if (!item) return null;
                return (
                  <TreeRow
                    key={item.getId()}
                    item={item}
                    start={vi.start}
                    openPath={openPath}
                    canWrite={canWrite}
                    onDownload={download}
                    onRename={(n) => setDialog({ kind: "rename", path: n.path, name: n.name, isDir: n.is_dir })}
                    onDelete={(n) => setDialog({ kind: "delete", paths: [n.path] })}
                  />
                );
              })}
            </div>
            <div style={tree.getDragLineStyle()} className="pointer-events-none h-0.5 rounded-full bg-[var(--ws-accent)]" />
            {rootLoading && (
              <div className="flex justify-center py-10">
                <RiLoader4Line className="size-5 animate-spin text-[var(--ws-muted)]" />
              </div>
            )}
            {rootEmpty && (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-xs text-[var(--ws-muted)]">
                <RiFolderOpenLine className="size-8 opacity-60" />
                目录为空
                {canWrite && <span>把文件拖到这里即可上传</span>}
              </div>
            )}
          </div>
        )}

        {/* 多选操作条 */}
        {canWrite && selected.length > 1 && (
          <div className="flex shrink-0 items-center gap-2 border-t border-[var(--ws-border)] px-3 py-1.5 text-xs md:px-4">
            <span className="flex-1 text-[var(--ws-sub)]">已选 {selected.length} 项</span>
            <Button.Root
              size="xxsmall"
              variant="error"
              mode="lighter"
              onClick={() => setDialog({ kind: "delete", paths: selected.map((i) => toPath(i.getId())) })}
            >
              <Button.Icon as={RiDeleteBinLine} />
              删除
            </Button.Root>
          </div>
        )}

        <UploadQueue state={uploads} />
        <StatusBar>
          {truncatedDirs.length > 0 ? (
            <span className="truncate text-away-base">部分目录条目过多，仅显示前 10000 项</span>
          ) : (
            <span className="truncate">
              {canWrite ? "拖入上传 · F2 重命名 · Del 删除" : "单击查看 · 直接输入可查找"}
            </span>
          )}
          <span className="flex-1" />
          {singleSelected && !singleSelected.is_dir && (
            <span className="shrink-0 tabular-nums">{formatSize(singleSelected.size)}</span>
          )}
        </StatusBar>
      </div>

      {/* 右：编辑器 */}
      <div className={`min-w-0 flex-1 flex-col ${openPath ? "flex" : "hidden md:flex"}`}>
        {openPath ? (
          <FileEditor
            key={openPath}
            serviceId={serviceId}
            path={openPath}
            canWrite={canWrite}
            aceTheme={theme.ace}
            onDirtyChange={setDirty}
            onSaved={() => refreshDirs([parentOf(openPath)])}
            onClose={() => {
              if (!confirmLeave()) return;
              dirtyRef.current = false;
              setOpenPath(null);
            }}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-[var(--ws-hover)]">
              <RiFileCodeLine className="size-6 text-[var(--ws-muted)]" />
            </div>
            <div className="text-sm font-medium text-[var(--ws-fg)]">选择一个配置文件{canWrite ? "开始编辑" : "查看"}</div>
            <div className="max-w-xs text-xs leading-relaxed text-[var(--ws-muted)]">
              支持在线编辑 YAML、JSON、TOML，保存前自动校验语法。其他类型的文件可以下载；单个文件不超过 25 MB。
            </div>
          </div>
        )}
      </div>

      {/* 拖入提示 */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-end justify-center rounded-lg border-2 border-dashed border-[var(--ws-accent)] bg-[var(--ws-accent)]/5 pb-6">
          <span className="flex items-center gap-2 rounded-full bg-[var(--ws-accent)] px-3 py-1.5 text-xs font-medium text-[var(--ws-on-accent)] shadow-regular-md">
            <RiDragDropLine className="size-4" />
            松开即可上传到所指的目录
          </span>
        </div>
      )}

      <FileDialog state={dialog} onClose={() => setDialog(null)} onSubmit={handleDialogSubmit} />
    </div>
  );
}

function TreeRow({
  item,
  start,
  openPath,
  canWrite,
  onDownload,
  onRename,
  onDelete,
}: {
  item: ItemInstance<Node>;
  start: number;
  openPath: string | null;
  canWrite: boolean;
  onDownload: (node: Node) => void;
  onRename: (node: Node) => void;
  onDelete: (node: Node) => void;
}) {
  "use no memo";
  const node = item.getItemData();
  const level = item.getItemMeta().level;
  const isDir = item.isFolder();
  const expanded = isDir && item.isExpanded();
  const loading = node?.loading || (isDir && expanded && item.isLoading());
  const isOpen = !!node && !node.is_dir && node.path === openPath;
  const dimmed = !!node && !node.is_dir && !node.editable;
  const selected = item.isSelected();
  const dropTarget = item.isDragTarget() && isDir;

  const props = item.getProps();
  const rowAction = "flex size-6 shrink-0 items-center justify-center rounded text-[var(--ws-muted)] hover:bg-[var(--ws-hover)] hover:text-[var(--ws-fg)]";
  return (
    <div
      {...props}
      ref={(el) => {
        item.registerElement(el);
      }}
      className={[
        "group absolute inset-x-0 flex h-7 cursor-default select-none items-center gap-1.5 rounded-md pr-1 text-[13px] outline-none transition-colors duration-100",
        selected || isOpen ? "bg-[var(--ws-selected)]" : "hover:bg-[var(--ws-hover)]",
        "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--ws-accent)]/60",
        dropTarget ? "bg-[var(--ws-selected)] ring-1 ring-inset ring-[var(--ws-accent)]" : "",
        item.isMatchingSearch() ? "bg-away-lighter" : "",
      ].join(" ")}
      style={{ transform: `translateY(${start}px)`, paddingLeft: level * 14 + 4 }}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-[var(--ws-muted)]">
        {isDir &&
          (loading ? (
            <RiLoader4Line className="size-3.5 animate-spin" />
          ) : expanded ? (
            <RiArrowDownSLine className="size-4" />
          ) : (
            <RiArrowRightSLine className="size-4" />
          ))}
      </span>
      {node && <NodeIcon node={node} open={expanded} />}
      {item.isRenaming() ? (
        <input
          {...item.getRenameInputProps()}
          autoFocus
          className="h-6 min-w-0 flex-1 rounded bg-[var(--ws-bg)] px-1.5 text-[13px] text-[var(--ws-fg)] outline-none ring-1 ring-[var(--ws-accent)]"
        />
      ) : (
        <span
          className={`min-w-0 flex-1 truncate ${dimmed ? "text-[var(--ws-muted)]" : "text-[var(--ws-fg)]"} ${isOpen ? "font-medium" : ""}`}
          title={node?.path}
        >
          {item.getItemName()}
        </span>
      )}
      {node?.is_symlink && <RiLinkM className="size-3.5 shrink-0 text-[var(--ws-muted)]" aria-label="软链接" />}
      {node && !node.loading && !item.isRenaming() && (
        <>
          {!node.is_dir && (
            <span className="shrink-0 pr-1 text-[11px] tabular-nums text-[var(--ws-muted)] group-hover:hidden">
              {formatSize(node.size)}
            </span>
          )}
          <span className="hidden shrink-0 items-center group-hover:flex">
            {!node.is_dir && (
              <button
                type="button"
                tabIndex={-1}
                className={rowAction}
                title={node.size > MAX_FILE_BYTES ? "超过 25 MB，无法下载" : `下载（${formatSize(node.size)}）`}
                aria-label="下载"
                disabled={node.size > MAX_FILE_BYTES}
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload(node);
                }}
              >
                <RiDownload2Line className="size-3.5" />
              </button>
            )}
            {canWrite && (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  className={rowAction}
                  title="重命名（F2）"
                  aria-label="重命名"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(node);
                  }}
                >
                  <RiEditLine className="size-3.5" />
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  className={`${rowAction} hover:text-error-base`}
                  title="删除（Delete）"
                  aria-label="删除"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(node);
                  }}
                >
                  <RiDeleteBinLine className="size-3.5" />
                </button>
              </>
            )}
          </span>
        </>
      )}
    </div>
  );
}
