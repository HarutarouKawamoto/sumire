import { slotsOf } from '../reservations/openingHours';
import { isOverlapping } from '../reservations/overlap';
import type { Reservation, Slot } from '../reservations/types';

export type Seat = {
  readonly id: string;
  readonly label: string;
  readonly capacity: number;
};

const STAY = 90;

export function freeSlots(
  seat: Seat,
  date: string,
  partySize: number,
  reservations: readonly Reservation[],
): Slot[] {
  if (partySize > seat.capacity) return [];

  const taken = reservations.filter(
    (r) => r.seatId === seat.id && r.status === 'confirmed',
  );
  return slotsOf(date, STAY).filter(
    (slot) => !taken.some((r) => isOverlapping(slot, r.slot)),
  );
}
