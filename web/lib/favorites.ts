/**
 * 收藏服务存储工具
 * 使用 localStorage 持久化收藏的服务 ID 列表
 */

const STORAGE_KEY = "hypercraft-favorite-services";

export function getFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveFavorites(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore storage errors
  }
}

export function addFavorite(id: string): void {
  const favorites = getFavorites();
  if (!favorites.includes(id)) {
    favorites.push(id);
    saveFavorites(favorites);
  }
}

export function removeFavorite(id: string): void {
  const favorites = getFavorites();
  saveFavorites(favorites.filter(fav => fav !== id));
}

export function isFavorite(id: string): boolean {
  return getFavorites().includes(id);
}

export function reorderFavorites(ids: string[]): void {
  saveFavorites(ids);
}
