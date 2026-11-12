// 時刻は、その日の 0:00 からの分で表す（10:30 なら 630）
export type Slot = {
  readonly date: string;
  readonly from: number;
  readonly to: number;
};

export type ReservationStatus = 'confirmed' | 'cancelled';

export type Reservation = {
  readonly id: string;
  readonly seatId: string;
  readonly slot: Slot;
  readonly partySize: number;
  readonly status: ReservationStatus;
};
