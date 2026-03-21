export class SlidingWindowCache {
  constructor(radius = 2) {
    this.PRELOAD_RADIUS = radius;
    this.cache = new Map(); // Map<number, ImageBitmap>
  }

  has(index) {
    return this.cache.has(index);
  }

  get(index) {
    return this.cache.get(index);
  }

  set(index, bitmap) {
    this.cache.set(index, bitmap);
  }

  invalidate(index) {
    const bitmap = this.cache.get(index);
    bitmap?.close?.();
    this.cache.delete(index);
  }

  evict(currentIndex) {
    const min = currentIndex - this.PRELOAD_RADIUS - 1;
    const max = currentIndex + this.PRELOAD_RADIUS + 1;
    for (const key of this.cache.keys()) {
      if (key < min || key > max) {
        this.cache.get(key)?.close?.();
        this.cache.delete(key);
      }
    }
  }

  getNeeded(currentIndex, total) {
    const needed = [];
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
  shiftAfterDelete(deletedIndex) {
    const newCache = new Map();
    for (const [idx, bitmap] of this.cache.entries()) {
      if (idx === deletedIndex) {
        bitmap?.close?.();
        continue;
      }
      newCache.set(idx > deletedIndex ? idx - 1 : idx, bitmap);
    }
    this.cache = newCache;
  }

  clear() {
    for (const bitmap of this.cache.values()) {
      bitmap?.close?.();
    }
    this.cache = new Map();
  }
}
