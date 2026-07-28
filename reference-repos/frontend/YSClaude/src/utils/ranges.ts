import { HiddenRange } from '../types';

/**
 * 合并隐藏楼层范围：
 * - 按起点排序后线性扫描
 * - 重叠或相邻（如 1-5 与 6-10）的范围会被并入同一段（→ 1-10）
 * 返回新数组，不修改入参。
 *
 * 例：[{1,6},{3,7}] → [{1,7}]；[{1,3},{5,7}] → [{1,3},{5,7}]
 */
export function mergeRanges(ranges: HiddenRange[]): HiddenRange[] {
  if (ranges.length <= 1) return ranges.map((r) => ({ ...r }));

  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: HiddenRange[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.from <= last.to + 1) {
      // 重叠或紧邻 → 扩展当前段的终点
      last.to = Math.max(last.to, cur.to);
    } else {
      merged.push({ ...cur });
    }
  }

  return merged;
}

export function subtractRange(ranges: HiddenRange[], removal: HiddenRange): HiddenRange[] {
  const next: HiddenRange[] = [];

  for (const range of ranges) {
    if (removal.to < range.from || removal.from > range.to) {
      next.push({ ...range });
      continue;
    }

    if (removal.from > range.from) {
      next.push({ from: range.from, to: removal.from - 1 });
    }

    if (removal.to < range.to) {
      next.push({ from: removal.to + 1, to: range.to });
    }
  }

  return mergeRanges(next.filter((range) => range.from <= range.to));
}
