/**
 * 本地排序存储工具
 * 为非 devtoken 用户提供本地拖拽排序功能
 */

import type { ServiceSummary, ServiceGroup } from "@/lib/api";

const SERVICE_ORDER_KEY = "hypercraft-local-service-order";
const GROUP_ORDER_KEY = "hypercraft-local-group-order";

// 服务排序数据结构: { [serviceId]: order }
type ServiceOrderMap = Record<string, number>;

// 分组排序数据结构: [groupId, groupId, ...]
type GroupOrderList = string[];

/**
 * 获取本地服务排序
 */
export function getLocalServiceOrder(): ServiceOrderMap {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(SERVICE_ORDER_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * 保存本地服务排序
 */
export function saveLocalServiceOrder(order: ServiceOrderMap): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SERVICE_ORDER_KEY, JSON.stringify(order));
  } catch {
    // ignore storage errors
  }
}

/**
 * 获取本地分组排序
 */
export function getLocalGroupOrder(): GroupOrderList {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(GROUP_ORDER_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * 保存本地分组排序
 */
export function saveLocalGroupOrder(order: GroupOrderList): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(order));
  } catch {
    // ignore storage errors
  }
}

/**
 * 获取服务的有效排序值
 * @param service 服务对象
 * @param isAdmin 是否是 admin (devtoken 用户)
 * @returns 排序值
 */
export function getServiceOrder(service: ServiceSummary, isAdmin: boolean): number {
  if (isAdmin) {
    // admin 用户使用远程 order
    return service.order ?? 0;
  }
  // 普通用户优先使用本地 order，没有则使用远程 order
  const localOrder = getLocalServiceOrder();
  return localOrder[service.id] ?? service.order ?? 0;
}

/**
 * 应用排序到服务列表
 * @param services 服务列表
 * @param isAdmin 是否是 admin
 * @returns 带有正确 order 的服务列表
 */
export function applyServiceOrder(services: ServiceSummary[], isAdmin: boolean): ServiceSummary[] {
  if (isAdmin) {
    return services;
  }
  const localOrder = getLocalServiceOrder();
  return services.map(service => ({
    ...service,
    order: localOrder[service.id] ?? service.order ?? 0,
  }));
}

/**
 * 应用排序到分组列表
 * @param groups 分组列表
 * @param isAdmin 是否是 admin
 * @returns 排序后的分组列表
 */
export function applyGroupOrder(groups: ServiceGroup[], isAdmin: boolean): ServiceGroup[] {
  if (isAdmin) {
    return [...groups].sort((a, b) => a.order - b.order);
  }
  
  const localOrder = getLocalGroupOrder();
  if (localOrder.length === 0) {
    // 没有本地排序，使用远程排序
    return [...groups].sort((a, b) => a.order - b.order);
  }
  
  // 按本地排序
  return [...groups].sort((a, b) => {
    const aIndex = localOrder.indexOf(a.id);
    const bIndex = localOrder.indexOf(b.id);
    // 不在本地排序中的放到最后
    const aOrder = aIndex === -1 ? Infinity : aIndex;
    const bOrder = bIndex === -1 ? Infinity : bIndex;
    return aOrder - bOrder;
  });
}

/**
 * 更新本地服务排序（拖拽后调用）
 * @param groupServices 分组内的服务列表（已按新顺序排列）
 */
export function updateLocalServiceOrder(groupServices: ServiceSummary[]): void {
  const localOrder = getLocalServiceOrder();
  groupServices.forEach((service, index) => {
    localOrder[service.id] = index;
  });
  saveLocalServiceOrder(localOrder);
}

/**
 * 更新本地分组排序（拖拽后调用）
 * @param groups 分组列表（已按新顺序排列）
 */
export function updateLocalGroupOrder(groups: ServiceGroup[]): void {
  const order = groups.map(g => g.id);
  saveLocalGroupOrder(order);
}
