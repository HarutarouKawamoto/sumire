import type { Reservation, Slot } from './types';

// 半開区間 [from, to) どうしの重なり。端が接するだけなら重ならない
export function isOverlapping(a: Slot, b: Slot): boolean {
  return a.date === b.date && a.from < b.to && b.from < a.to;
}

export function findConflicts(
  slot: Slot,
  seatId: string,
  existing: readonly Reservation[],
): Reservation[] {
  return existing.filter(
    (r) =>
      r.seatId === seatId &&
      r.status === 'confirmed' &&
      isOverlapping(slot, r.slot),
  );
}
