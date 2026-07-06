import React from "react";
import { TimeSlot, AnimalBooth, SystemSettings } from "../types";
import LucideIcon from "./LucideIcon";
import { checkIsWithinBookingHours } from "../utils";

interface SlotSelectorProps {
  selectedBooth: AnimalBooth;
  slots: TimeSlot[];
  onSelectSlot: (slot: TimeSlot) => void;
  simulatedTime: { hour: number; minute: number };
  systemSettings: SystemSettings | null;
}

export default function SlotSelector({
  selectedBooth,
  slots,
  onSelectSlot,
  simulatedTime,
  systemSettings
}: SlotSelectorProps) {
  const startHours = systemSettings?.bookingStartTime || "11:00";
  const endHours = systemSettings?.bookingEndTime || "14:00";

  // 時間チェック
  const currentMinutes = simulatedTime.hour * 60 + simulatedTime.minute;
  const [startH, startM] = startHours.split(":").map(Number);
  const startMinutes = startH * 60 + startM;

  const [endH, endM] = endHours.split(":").map(Number);
  const endMinutes = endH * 60 + endM;

  const isBeforeStart = currentMinutes < startMinutes;
  const isAfterEnd = currentMinutes > endMinutes;

  // 1. 予約開始前
  if (isBeforeStart) {
    return (
      <div className="bg-[#FFF5F5] border-4 border-[#E53E3E] rounded-[2.5rem] p-8 text-center space-y-3 shadow-md">
        <span className="inline-block text-4xl animate-bounce">📢</span>
        <h3 className="text-xl font-black text-[#E53E3E]">予約開始前です。</h3>
        <p className="text-xs text-gray-500 font-bold leading-normal">
          本日の予約受付は <span className="text-sm font-mono text-[#E53E3E] font-black">{startHours}</span> から開始されます。
          <br />
          今しばらくお待ちください。お楽しみに！🐾
        </p>
      </div>
    );
  }

  // 2. 予約受付終了
  if (isAfterEnd) {
    return (
      <div className="bg-gray-50 border-4 border-gray-300 rounded-[2.5rem] p-8 text-center space-y-3 shadow-md">
        <span className="inline-block text-4xl">🏁</span>
        <h3 className="text-xl font-black text-gray-600">本日の受付は終了しました。</h3>
        <p className="text-xs text-gray-500 font-bold leading-normal">
          本日の「どうぶつふれあい体験」の整理券配布はすべて終了いたしました。
          <br />
          たくさんのご来場ありがとうございました！🐾
        </p>
      </div>
    );
  }

  // 選択されたブースのスロットのみを抽出、時間順にソート
  const boothSlots = slots
    .filter((s) => s.animalId === selectedBooth.id)
    .sort((a, b) => {
      const [aH, aM] = a.startTime.split(":").map(Number);
      const [bH, bM] = b.startTime.split(":").map(Number);
      return (aH * 60 + aM) - (bH * 60 + bM);
    });

  return (
    <div className="bg-white rounded-[2rem] p-6 shadow-md border-4 border-[#FED7D7] space-y-5">
      <div className="flex items-center justify-between border-b-2 border-dashed border-[#FED7D7] pb-4">
        <div className="flex items-center space-x-2">
          <span className="p-2 bg-[#FFF5F5] text-[#E53E3E] rounded-2xl">
            <LucideIcon name="Clock" size={18} />
          </span>
          <div>
            <h3 className="text-base font-black text-[#2D3748]">
              時間枠（スロット）の選択
            </h3>
            <p className="text-xs text-gray-400 font-bold">体験時間：30分 / 定員制</p>
          </div>
        </div>

        <span className="text-xs bg-[#E53E3E] text-white font-black px-3.5 py-1 rounded-full border-2 border-white shadow-sm">
          {selectedBooth.name}
        </span>
      </div>

      {/* グループ予約へのアドバイス */}
      <div className="bg-[#FBD38D] border-2 border-[#DD6B20] rounded-2xl p-3.5 flex items-start gap-2.5 text-xs text-[#742A2A] leading-relaxed font-bold">
        <div className="text-[#DD6B20] mt-0.5 shrink-0">
          <LucideIcon name="AlertCircle" size={16} />
        </div>
        <div>
          <strong className="font-black text-rose-950">👥 複数人で体験したい方へ：</strong>
          <br />
          人数選択（1〜4名）をしていただくことで、一度の予約で全員分の席をアトミックに確保できます。
        </div>
      </div>

      {/* スロットグリッド */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {boothSlots.map((slot) => {
          const booked = slot.bookedCount || 0;
          const remaining = Math.max(0, slot.capacity - booked);
          const isFull = remaining <= 0;

          // 当日、予約可能時間（スロット開始前）かチェック
          const { canBook } = checkIsWithinBookingHours(
            simulatedTime.hour,
            simulatedTime.minute,
            slot.startTime,
            startHours,
            endHours
          );

          // カードのスタイル決定
          let cardStyle = "bg-white border-4 border-[#E53E3E] shadow-[4px_4px_0px_#E53E3E] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_#E53E3E] cursor-pointer";
          let statusText = `残り ${remaining} 席`;
          let statusColor = "bg-[#E53E3E] text-white border-white";
          let disableBtn = false;

          if (isFull) {
            cardStyle = "bg-gray-100 border-4 border-gray-300 text-gray-400 opacity-70 cursor-not-allowed";
            statusText = "満員御礼 🐾";
            statusColor = "bg-gray-400 text-white border-white";
            disableBtn = true;
          } else if (!canBook) {
            cardStyle = "bg-gray-100 border-4 border-gray-300 text-gray-400 opacity-50 cursor-not-allowed";
            statusText = "受付終了";
            statusColor = "bg-gray-400 text-white border-white";
            disableBtn = true;
          } else if (remaining <= 2) {
            cardStyle = "bg-white border-4 border-[#F6AD55] shadow-[4px_4px_0px_#F6AD55] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_#F6AD55] cursor-pointer";
            statusText = `残りわずか！ あと ${remaining} 席`;
            statusColor = "bg-[#F6AD55] text-white border-white animate-pulse";
          } else {
            statusColor = "bg-[#319795] text-white border-white";
          }

          return (
            <button
              key={slot.id}
              onClick={() => !disableBtn && onSelectSlot(slot)}
              disabled={disableBtn}
              id={`slot-card-${slot.id}`}
              className={`p-4 rounded-2xl flex items-center justify-between text-left transition-all duration-150 ${cardStyle}`}
            >
              <div className="space-y-1">
                <div className="flex items-center">
                  <span className="text-base font-black text-gray-800">
                    {slot.startTime}~{slot.endTime}
                  </span>
                </div>
                <div className="flex items-center space-x-1">
                  <span className="text-[10px] text-gray-400 font-bold">定員: {slot.capacity}名</span>
                </div>
              </div>

              {/* 空き数ステータスタグ */}
              <div className={`text-[11px] font-black px-3 py-1.5 rounded-full border-2 shadow-sm ${statusColor}`}>
                {statusText}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
