import type { Slot } from './types';

const OPEN = 8 * 60;
const CLOSE = 18 * 60;
const STEP = 30;

export function withinOpeningHours(slot: Slot): boolean {
  return slot.from >= OPEN && slot.to <= CLOSE && slot.from < slot.to;
}

// 営業時間を STEP 分刻みに区切り、length 分の枠を並べる
export function slotsOf(date: string, length: number): Slot[] {
  const slots: Slot[] = [];
  for (let from = OPEN; from + length <= CLOSE; from += STEP) {
    slots.push({ date, from, to: from + length });
  }
  return slots;
}

export function toClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}
