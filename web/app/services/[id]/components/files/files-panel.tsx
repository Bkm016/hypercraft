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
  RiDeleteBinLine,
  RiDownload2Line,
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
import { notification } from "@/hooks/use-notification";
import { api, type ApiError, type FileEntry } from "@/lib/api";
import { FileDialog, type FileDialogState } from "./file-dialog";
import { FileEditor } from "./file-editor";
import { UploadQueue, useUploads, MAX_FILE_BYTES } from "./uploads";

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
    return <Icon className="size-4 shrink-0 text-amber-400/90" />;
  }
  const Icon = node.editable ? RiFileCodeLine : RiFile3Line;
  return <Icon className={`size-4 shrink-0 ${node.editable ? "text-sky-400" : "text-neutral-500"}`} />;
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
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-stroke-soft-200 bg-bg-white-0 p-10 text-center">
        <RiFolderOpenLine className="size-10 text-text-soft-400" />
        <div className="text-sm font-medium text-text-strong-950">未配置工作目录</div>
        <div className="text-sm text-text-sub-600">在「编辑」中为服务设置工作目录后，即可在这里浏览和编辑配置文件。</div>
      </div>
    );
  }

  const selected = tree.getSelectedItems();
  const singleSelected = selected.length === 1 ? selected[0].getItemData() : null;
  const toolBtn =
    "rounded p-1.5 text-neutral-400 hover:bg-white/10 hover:text-neutral-200 disabled:pointer-events-none disabled:opacity-30";

  return (
    <div className="terminal-dark flex min-h-0 flex-1 overflow-hidden rounded-lg border border-stroke-soft-200">
      {/* 左：文件树 */}
      <div
        className={`flex min-h-0 w-full flex-col border-r border-white/10 md:w-72 md:shrink-0 lg:w-80 ${
          openPath ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-2 py-1.5">
          {tree.isSearchOpen() ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded bg-black/40 px-2 py-1 ring-1 ring-white/10">
              <RiSearchLine className="size-3.5 shrink-0 text-neutral-500" />
              <input
                {...tree.getSearchInputElementProps()}
                placeholder="搜索已展开的文件"
                className="min-w-0 flex-1 bg-transparent text-xs text-neutral-200 outline-none placeholder:text-neutral-600"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => tree.openSearch()}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-neutral-500 hover:bg-white/5"
              title="在树中直接输入字符也可以搜索"
            >
              <RiSearchLine className="size-3.5 shrink-0" />
              <span className="truncate">搜索</span>
            </button>
          )}
          {canWrite && (
            <>
              <button type="button" className={toolBtn} title="上传文件（≤ 25 MB，也可直接拖入）" aria-label="上传文件" onClick={() => pickUpload(currentDir())}>
                <RiUpload2Line className="size-4" />
              </button>
              <button type="button" className={toolBtn} title="新建配置文件" aria-label="新建配置文件" onClick={() => setDialog({ kind: "create-file", dir: currentDir() })}>
                <RiFileAddLine className="size-4" />
              </button>
              <button type="button" className={toolBtn} title="新建文件夹" aria-label="新建文件夹" onClick={() => setDialog({ kind: "create-dir", dir: currentDir() })}>
                <RiFolderAddLine className="size-4" />
              </button>
              <button
                type="button"
                className={toolBtn}
                title="重命名（F2）"
                aria-label="重命名"
                disabled={!singleSelected}
                onClick={() =>
                  singleSelected &&
                  setDialog({ kind: "rename", path: singleSelected.path, name: singleSelected.name, isDir: singleSelected.is_dir })
                }
              >
                <RiEditLine className="size-4" />
              </button>
              <button
                type="button"
                className={toolBtn}
                title="删除（Delete）"
                aria-label="删除"
                disabled={!selected.length}
                onClick={() => setDialog({ kind: "delete", paths: selected.map((i) => toPath(i.getId())) })}
              >
                <RiDeleteBinLine className="size-4" />
              </button>
            </>
          )}
          <button
            type="button"
            className={toolBtn}
            title="下载"
            aria-label="下载"
            disabled={!singleSelected || singleSelected.is_dir}
            onClick={() => singleSelected && download(singleSelected)}
          >
            <RiDownload2Line className="size-4" />
          </button>
          <button type="button" className={toolBtn} title="刷新" aria-label="刷新" onClick={refreshAll}>
            <RiRefreshLine className="size-4" />
          </button>
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
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-neutral-400">
            {rootError}
            <button type="button" className="rounded bg-white/10 px-3 py-1 text-xs text-neutral-200 hover:bg-white/20" onClick={refreshAll}>
              重试
            </button>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="hc-terminal-surface relative min-h-0 flex-1 overflow-auto py-1"
            // 拖到空白处 → 上传到根目录（行上的拖放由 Headless Tree 处理）
            onDragOver={(e) => {
              if (canWrite && e.dataTransfer.types.includes("Files")) e.preventDefault();
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
                return <TreeRow key={item.getId()} item={item} start={vi.start} openPath={openPath} onDownload={download} />;
              })}
            </div>
            <div style={tree.getDragLineStyle()} className="pointer-events-none h-0.5 bg-primary-base" />
            {items.length === 0 && tree.getItemInstance(ROOT_ID)?.isLoading() && (
              <div className="flex justify-center py-10">
                <RiLoader4Line className="size-5 animate-spin text-neutral-500" />
              </div>
            )}
          </div>
        )}
        <UploadQueue state={uploads} />
        <div className="flex min-h-8 shrink-0 items-center border-t border-white/10 bg-[#0a0a0a] px-3 text-[11px] text-neutral-500">
          {truncatedDirs.length > 0 ? (
            <span className="truncate text-yellow-500/80">部分目录条目过多，仅显示前 10000 项</span>
          ) : (
            <span className="truncate">
              单击打开{canWrite ? " · 拖入文件上传 · F2 重命名 · Delete 删除" : ""} · 直接输入可搜索
            </span>
          )}
        </div>
      </div>

      {/* 右：编辑器 */}
      <div className={`min-w-0 flex-1 flex-col ${openPath ? "flex" : "hidden md:flex"}`}>
        {openPath ? (
          <FileEditor
            key={openPath}
            serviceId={serviceId}
            path={openPath}
            canWrite={canWrite}
            onDirtyChange={setDirty}
            onSaved={() => refreshDirs([parentOf(openPath)])}
            onClose={() => {
              if (!confirmLeave()) return;
              dirtyRef.current = false;
              setOpenPath(null);
            }}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-[#1e1e1e] text-center text-sm text-neutral-500">
            <RiFileCodeLine className="size-10 text-neutral-600" />
            <div>选择左侧的配置文件进行{canWrite ? "编辑" : "查看"}</div>
            <div className="text-xs text-neutral-600">
              在线编辑 YAML · JSON · TOML；其他文件可下载{canWrite ? "，拖入文件即可上传" : ""}（单文件 ≤ 25 MB）
            </div>
          </div>
        )}
      </div>

      <FileDialog state={dialog} onClose={() => setDialog(null)} onSubmit={handleDialogSubmit} />
    </div>
  );
}

function TreeRow({
  item,
  start,
  openPath,
  onDownload,
}: {
  item: ItemInstance<Node>;
  start: number;
  openPath: string | null;
  onDownload: (node: Node) => void;
}) {
  "use no memo";
  const node = item.getItemData();
  const level = item.getItemMeta().level;
  const isDir = item.isFolder();
  const expanded = isDir && item.isExpanded();
  const loading = node?.loading || (isDir && expanded && item.isLoading());
  const isOpen = !!node && !node.is_dir && node.path === openPath;
  const dimmed = !!node && !node.is_dir && !node.editable;

  const props = item.getProps();
  return (
    <div
      {...props}
      ref={(el) => {
        item.registerElement(el);
      }}
      className={[
        "group absolute inset-x-0 flex h-7 cursor-default select-none items-center gap-1.5 pr-3 text-[13px] outline-none",
        item.isSelected() ? "bg-primary-base/25" : "hover:bg-white/5",
        item.isFocused() ? "ring-1 ring-inset ring-primary-base/60" : "",
        item.isDragTarget() && isDir ? "bg-primary-base/30 ring-1 ring-inset ring-primary-base" : "",
        item.isDragTarget() && !isDir ? "bg-primary-base/10" : "",
        item.isMatchingSearch() ? "bg-yellow-500/20" : "",
        isOpen ? "shadow-[inset_2px_0_0_var(--color-primary-base,#3b82f6)]" : "",
      ].join(" ")}
      style={{ transform: `translateY(${start}px)`, paddingLeft: level * 14 + 6 }}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-neutral-500">
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
          className="min-w-0 flex-1 rounded bg-black px-1 text-[13px] text-neutral-100 outline-none ring-1 ring-primary-base"
        />
      ) : (
        <span className={`min-w-0 flex-1 truncate ${dimmed ? "text-neutral-500" : "text-neutral-200"}`} title={node?.path}>
          {item.getItemName()}
        </span>
      )}
      {node?.is_symlink && <RiLinkM className="size-3.5 shrink-0 text-neutral-500" aria-label="软链接" />}
      {node && !node.is_dir && !node.loading && (
        <>
          <span className="shrink-0 text-[11px] tabular-nums text-neutral-600 group-hover:hidden">{formatSize(node.size)}</span>
          <button
            type="button"
            tabIndex={-1}
            className="hidden shrink-0 rounded p-0.5 text-neutral-400 hover:bg-white/10 hover:text-neutral-100 group-hover:block"
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
        </>
      )}
    </div>
  );
}
