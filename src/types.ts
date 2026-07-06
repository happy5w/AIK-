export interface AnimalBooth {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide-reactのアイコン名
  color: string; // Tailwindカラー (例: 'bg-red-500', 'text-red-600')
}

export interface TimeSlot {
  id: string;
  animalId: string;
  startTime: string; // 例: '11:00'
  endTime: string;   // 例: '11:30'
  capacity: number;  // 定員
  bookedCount: number; // 現在の予約数
}

export interface Companion {
  name: string;
  phone: string;
}

export interface Reservation {
  id: string;
  slotId: string;
  animalId: string;
  userName: string; // 予約者氏名
  phone?: string; // 電話番号
  relationship?: string; // 関係性 (学生 / 学生保護者 / 一般)
  partySize: number; // 同伴者を含む全人数 (1〜4)
  companions?: Companion[]; // 同行者リスト
  createdAt: any; // Firebase Timestamp or ISO string
  status: 'booked' | 'checked_in' | 'cancelled';
  ticketNumber: string; // 整理券番号 (例: A-015, DOG-1100-01 など)
  deviceToken: string; // ローカル識別用
  isAdminAdded?: boolean; // スタッフによる手動追加
}

export interface SystemSettings {
  isBookingOpen: boolean; // 予約受付中フラグ
  simulationDate: string; // シミュレーション用日付 (例: '2026-06-25')
  adminPasscode: string;  // スタッフ用パスコード (デフォルト: 'fes123')
  bookingStartTime?: string; // 予約開始時刻 (例: '10:00' または '11:00')
  bookingEndTime?: string;   // 予約終了時刻 (例: '14:00' または '15:00')
}

