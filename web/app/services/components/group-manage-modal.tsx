"use client";

import { useState, useEffect } from "react";
import { RiAddLine, RiFolderLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import * as Button from "@/components/ui/button";
import { api, type ServiceGroup } from "@/lib/api";
import { notification } from "@/hooks/use-notification";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { applyGroupOrder, updateLocalGroupOrder } from "../local-order";
import { SortableGroupItem } from "./sortable-group-item";
import { GroupFormModal } from "./group-form-modal";
import { DeleteGroupModal } from "./delete-group-modal";

export interface GroupManageModalProps {
  open: boolean;
  onClose: () => void;
  groups: ServiceGroup[];
  onUpdate: () => void | Promise<void>;
  isAdmin: boolean;
}

export function GroupManageModal({
  open,
  onClose,
  groups,
  onUpdate,
  isAdmin,
}: GroupManageModalProps) {
  // 本地排序状态
  const [localGroups, setLocalGroups] = useState<ServiceGroup[]>(() => 
    applyGroupOrder(groups, isAdmin)
  );
  
  // 子弹窗状态
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ServiceGroup | undefined>();
  const [deletingGroup, setDeletingGroup] = useState<ServiceGroup | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 100,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // 同步外部 groups 变化
  useEffect(() => {
    if (open) {
      setLocalGroups(applyGroupOrder(groups, isAdmin));
    }
  }, [open, groups, isAdmin]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = localGroups.findIndex((g) => g.id === active.id);
    const newIndex = localGroups.findIndex((g) => g.id === over.id);
    const newGroups = arrayMove(localGroups, oldIndex, newIndex);
    setLocalGroups(newGroups);

    if (isAdmin) {
      try {
        await api.reorderGroups(newGroups.map((g) => g.id));
        await onUpdate();
      } catch (err) {
        const apiErr = err as { message?: string };
        notification({
          status: "error",
          title: apiErr.message || "重新排序分组失败",
        });
        setLocalGroups(applyGroupOrder(groups, isAdmin));
      }
    } else {
      updateLocalGroupOrder(newGroups);
    }
  };

  const handleOpenCreate = () => {
    setEditingGroup(undefined);
    setShowFormModal(true);
  };

  const handleOpenEdit = (group: ServiceGroup) => {
    setEditingGroup(group);
    setShowFormModal(true);
  };

  const handleFormSuccess = async () => {
    setShowFormModal(false);
    setEditingGroup(undefined);
    await onUpdate();
  };

  const handleDeleteSuccess = async () => {
    setLocalGroups((prev) => prev.filter((g) => g.id !== deletingGroup?.id));
    setDeletingGroup(null);
    await onUpdate();
  };

  return (
    <>
      {/* 主弹窗 - 分组列表 */}
      <FormDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
        <FormDialog.Content>
          <div>
            <FormDialog.Header
              icon={RiFolderLine}
              title="管理分组"
              description={isAdmin ? "创建、编辑和排序服务分组，拖拽可调整顺序" : "拖拽可调整分组顺序"}
            />

            <FormDialog.Body className="space-y-4">
              {/* 分组列表 */}
              {localGroups.length > 0 ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={localGroups.map((g) => g.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {localGroups.map((group) => (
                        <SortableGroupItem
                          key={group.id}
                          group={group}
                          onEdit={() => handleOpenEdit(group)}
                          onDelete={() => setDeletingGroup(group)}
                          isAdmin={isAdmin}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : (
                <div className="text-center py-8 text-text-soft-400 border border-dashed border-stroke-soft-200 rounded-xl">
                  <RiFolderLine className="size-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">
                    {isAdmin ? "暂无分组，点击下方按钮创建" : "暂无分组"}
                  </p>
                </div>
              )}

              {/* 新建按钮 - 仅 admin */}
              {isAdmin && (
                <Button.Root
                  variant="neutral"
                  mode="stroke"
                  className="w-full"
                  onClick={handleOpenCreate}
                >
                  <Button.Icon as={RiAddLine} />
                  新建分组
                </Button.Root>
              )}
            </FormDialog.Body>

            <FormDialog.Footer>
              <FormDialog.Button variant="secondary" onClick={onClose}>
                关闭
              </FormDialog.Button>
            </FormDialog.Footer>
          </div>
        </FormDialog.Content>
      </FormDialog.Root>

      {/* 创建/编辑分组弹窗 */}
      <GroupFormModal
        open={showFormModal}
        onClose={() => {
          setShowFormModal(false);
          setEditingGroup(undefined);
        }}
        onSuccess={handleFormSuccess}
        group={editingGroup}
      />

      {/* 删除确认弹窗 */}
      {deletingGroup && (
        <DeleteGroupModal
          open={!!deletingGroup}
          groupId={deletingGroup.id}
          groupName={deletingGroup.name}
          onClose={() => setDeletingGroup(null)}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </>
  );
}
