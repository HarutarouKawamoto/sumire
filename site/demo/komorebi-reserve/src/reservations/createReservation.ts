import { withinOpeningHours } from './openingHours';
import { findConflicts } from './overlap';
import type { Reservation, Slot } from './types';

export type CreateResult =
  | { readonly ok: true; readonly reservation: Reservation }
  | { readonly ok: false; readonly status: 409 | 422; readonly reason: string };

export type ReservationStore = {
  listBySeat(seatId: string, date: string): Promise<Reservation[]>;
  insert(reservation: Reservation): Promise<void>;
};

type Input = { seatId: string; slot: Slot; partySize: number };

const TAKEN = { ok: false, status: 409, reason: 'その時間は埋まっています' } as const;

export async function createReservation(
  store: ReservationStore,
  input: Input,
  newId: () => string,
): Promise<CreateResult> {
  if (!withinOpeningHours(input.slot)) {
    return { ok: false, status: 422, reason: '営業時間の外です' };
  }

  // ここは早めに断るための確認。最後の砦はデータベースの排他制約
  const existing = await store.listBySeat(input.seatId, input.slot.date);
  if (findConflicts(input.slot, input.seatId, existing).length > 0) {
    return TAKEN;
  }

  const reservation: Reservation = {
    id: newId(),
    seatId: input.seatId,
    slot: input.slot,
    partySize: input.partySize,
    status: 'confirmed',
  };

  try {
    await store.insert(reservation);
  } catch (err) {
    if (isExclusionViolation(err)) return TAKEN;
    throw err;
  }
  return { ok: true, reservation };
}

function isExclusionViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23P01';
}
