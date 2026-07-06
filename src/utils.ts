import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

// デバイス一意のトークンを取得または生成
export function getOrCreateDeviceToken(): string {
  let token = localStorage.getItem("animal_fes_device_token");
  if (!token) {
    token = "dev_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem("animal_fes_device_token", token);
  }
  return token;
}

// 整理券番号の生成 (例: A-015)
export function generateTicketNumber(boothId: string, startTime: string, sequence: number): string {
  let prefix = "A";
  if (boothId === "dog1") prefix = "A";
  else if (boothId === "dog2") prefix = "B";
  else if (boothId === "dog3") prefix = "C";
  else if (boothId === "cat") prefix = "D";
  else if (boothId === "small_animal") prefix = "E";
  else prefix = boothId.substring(0, 1).toUpperCase();

  const seqStr = sequence.toString().padStart(3, "0");
  return `${prefix}-${seqStr}`;
}

// 現在時刻が予約可能時間内であるかチェックする
export function checkIsWithinBookingHours(
  simulatedHour: number,
  simulatedMin: number,
  slotStartTime: string,
  bookingStartTime: string = "11:00",
  bookingEndTime: string = "14:00"
): { canBook: boolean; message: string; isBeforeStart: boolean; isAfterEnd: boolean } {
  const currentMinutes = simulatedHour * 60 + simulatedMin;

  // 設定された開始時刻と終了時刻をパース
  const [startH, startM] = bookingStartTime.split(":").map(Number);
  const startMinutes = startH * 60 + startM;

  const [endH, endM] = bookingEndTime.split(":").map(Number);
  const endMinutes = endH * 60 + endM;

  // スロット開始時刻のパース
  const [slotH, slotM] = slotStartTime.split(":").map(Number);
  const slotMinutes = slotH * 60 + slotM;

  // 1. 開始前チェック
  if (currentMinutes < startMinutes) {
    return { 
      canBook: false, 
      message: "予約開始前です。", 
      isBeforeStart: true, 
      isAfterEnd: false 
    };
  }
  
  // 2. 終了後チェック
  if (currentMinutes > endMinutes) {
    return { 
      canBook: false, 
      message: "本日の受付は終了しました。", 
      isBeforeStart: false, 
      isAfterEnd: true 
    };
  }

  // 3. 各枠の開始時間を過ぎているかチェック
  if (currentMinutes >= slotMinutes) {
    return { 
      canBook: false, 
      message: "この時間枠の予約受付時間は終了しました。", 
      isBeforeStart: false, 
      isAfterEnd: false 
    };
  }

  return { canBook: true, message: "", isBeforeStart: false, isAfterEnd: false };
}

