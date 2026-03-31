export class SlidingWindowCache<T extends { close?: () => void }> {
  private readonly PRELOAD_RADIUS: number;
  private cache: Map<number, T>;

  constructor(radius = 2) {
    this.PRELOAD_RADIUS = radius;
    this.cache = new Map<number, T>();
  }

  has(index: number): boolean {
    return this.cache.has(index);
  }

  get(index: number): T | undefined {
    return this.cache.get(index);
  }

  set(index: number, item: T): void {
    this.cache.set(index, item);
  }

  invalidate(index: number): void {
    const item = this.cache.get(index);
    item?.close?.();
    this.cache.delete(index);
  }

  evict(currentIndex: number): void {
    const min = currentIndex - this.PRELOAD_RADIUS - 2;
    const max = currentIndex + this.PRELOAD_RADIUS + 2;
    for (const key of this.cache.keys()) {
      if (key < min || key > max) {
        this.cache.get(key)?.close?.();
        this.cache.delete(key);
      }
    }
  }

  getNeeded(currentIndex: number, total: number): number[] {
    const needed: number[] = [];
    for (
      let i = currentIndex - this.PRELOAD_RADIUS;
      i <= currentIndex + this.PRELOAD_RADIUS;
      i++
    ) {
      if (i >= 0 && i < total && !this.cache.has(i)) {
        needed.push(i);
      }
    }
    return needed;
  }

  // 특정 인덱스 삭제 후 캐시 키를 한 칸씩 당김
  shiftAfterDelete(deletedIndex: number): void {
    const newCache = new Map<number, T>();
    for (const [idx, item] of this.cache.entries()) {
      if (idx === deletedIndex) {
        item?.close?.();
        continue;
      }
      newCache.set(idx > deletedIndex ? idx - 1 : idx, item);
    }
    this.cache = newCache;
  }

  clear(): void {
    for (const item of this.cache.values()) {
      item?.close?.();
    }
    this.cache = new Map<number, T>();
  }
}
