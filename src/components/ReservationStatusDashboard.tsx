import React from "react";
import { AnimalBooth, TimeSlot } from "../types";
import LucideIcon from "./LucideIcon";

interface ReservationStatusDashboardProps {
  booths: AnimalBooth[];
  slots: TimeSlot[];
  onSelectBooth: (boothId: string) => void;
  selectedBoothId: string;
}

export default function ReservationStatusDashboard({
  booths,
  slots,
  onSelectBooth,
  selectedBoothId
}: ReservationStatusDashboardProps) {
  // 各ブースの統計情報を計算
  const stats = booths.map(booth => {
    const boothSlots = slots.filter(s => s.animalId === booth.id);
    const totalCapacity = boothSlots.reduce((acc, s) => acc + s.capacity, 0);
    const totalBooked = boothSlots.reduce((acc, s) => acc + (s.bookedCount || 0), 0);
    const remaining = Math.max(0, totalCapacity - totalBooked);
    
    // 予約率
    const bookingRate = totalCapacity > 0 ? (totalBooked / totalCapacity) * 100 : 0;
    
    // 予約の取りやすさ判定
    let easeLevel: { text: string; color: string; bgColor: string; borderColor: string; icon: string } = {
      text: "空きあり・超ねらい目！🐾",
      color: "text-[#319795]",
      bgColor: "bg-[#E6FFFA]",
      borderColor: "border-[#B2F5EA]",
      icon: "Sparkles"
    };

    if (bookingRate >= 100) {
      easeLevel = {
        text: "満員御礼（キャンセル待ち）🐾",
        color: "text-gray-400",
        bgColor: "bg-gray-50",
        borderColor: "border-gray-200",
        icon: "Lock"
      };
    } else if (bookingRate >= 80) {
      easeLevel = {
        text: "残りわずか！お急ぎください！⏳",
        color: "text-[#E53E3E]",
        bgColor: "bg-[#FFF5F5]",
        borderColor: "border-[#FED7D7]",
        icon: "AlertTriangle"
      };
    } else if (bookingRate >= 50) {
      easeLevel = {
        text: "残り半分程度・お早めに！⏰",
        color: "text-[#DD6B20]",
        bgColor: "bg-[#FEEBC8]",
        borderColor: "border-[#FBD38D]",
        icon: "Clock"
      };
    }

    // ブースごとのテーマ設定
    const themeMap: Record<string, { bg: string; text: string; barColor: string; iconBg: string }> = {
      dog1: { bg: "bg-[#FED7D7]", text: "text-[#E53E3E]", barColor: "bg-[#E53E3E]", iconBg: "bg-red-50" },
      dog2: { bg: "bg-[#FEEBC8]", text: "text-[#DD6B20]", barColor: "bg-[#DD6B20]", iconBg: "bg-orange-50" },
      dog3: { bg: "bg-[#FEFCBF]", text: "text-[#D69E2E]", barColor: "bg-[#D69E2E]", iconBg: "bg-yellow-50" },
      cat: { bg: "bg-[#E6FFFA]", text: "text-[#319795]", barColor: "bg-[#319795]", iconBg: "bg-teal-50" },
      small_animal: { bg: "bg-[#FAF5FF]", text: "text-[#805AD5]", barColor: "bg-[#805AD5]", iconBg: "bg-purple-50" }
    };

    const theme = themeMap[booth.id] || { bg: "bg-gray-200", text: "text-gray-600", barColor: "bg-gray-500", iconBg: "bg-gray-50" };

    return {
      booth,
      totalCapacity,
      totalBooked,
      remaining,
      bookingRate,
      easeLevel,
      theme
    };
  });

  // 最も空いている（予約が取りやすい）ブースを決定
  const availableStats = stats.filter(s => s.remaining > 0);
  const easiestBooth = availableStats.length > 0 
    ? [...availableStats].sort((a, b) => b.remaining - a.remaining)[0] 
    : null;

  return (
    <div className="bg-white rounded-[2rem] p-6 shadow-md border-4 border-[#FED7D7] space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b-2 border-dashed border-gray-100 pb-4">
        <div>
          <h3 className="font-black text-[#2D3748] text-base flex items-center gap-1.5">
            <span>📊</span> リアルタイム予約空き状況メーター
          </h3>
          <p className="text-[10px] text-gray-500 font-bold leading-normal mt-0.5">
            各ブースの「予約の取りやすさ」を現在の残り枠から自動で計算しています。
          </p>
        </div>

        {/* 💡 おすすめおすすめレコメンドバッジ */}
        {easiestBooth && (
          <div className="flex items-center gap-2 bg-[#E6FFFA] border-2 border-[#B2F5EA] px-3.5 py-1.5 rounded-2xl shrink-0 animate-scale-in">
            <div className="text-[#319795] animate-bounce">
              <LucideIcon name="Sparkles" size={14} />
            </div>
            <div className="text-left">
              <span className="text-[9px] text-[#319795] font-black block leading-none">今のいちおし（最も空席あり）</span>
              <span className="text-[10px] text-gray-700 font-black">
                {easiestBooth.booth.name.split(" ")[0]} （残り {easiestBooth.remaining} 枠）
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 📊 視覚的な予約状況棒グラフ＆メーターリスト */}
      <div className="space-y-4">
        {stats.map(({ booth, totalCapacity, totalBooked, remaining, bookingRate, easeLevel, theme }) => {
          const isSelected = selectedBoothId === booth.id;
          return (
            <div 
              key={booth.id} 
              className={`p-3.5 rounded-2xl border-2 transition-all duration-200 flex flex-col md:flex-row md:items-center gap-4 ${
                isSelected 
                  ? "border-[#E53E3E] bg-[#FFF5F5]/30 shadow-inner" 
                  : "border-gray-100 bg-gray-50/50 hover:bg-gray-50"
              }`}
            >
              {/* ブース名とアイコン（左側） */}
              <div className="flex items-center gap-3 md:w-56 shrink-0">
                <div className={`p-2.5 rounded-xl ${theme.bg} ${theme.text} shrink-0 flex items-center justify-center`}>
                  <LucideIcon name={booth.icon} size={20} />
                </div>
                <div>
                  <h4 className="font-black text-xs text-[#2D3748]">{booth.name}</h4>
                  <p className="text-[9px] text-gray-400 font-bold mt-0.5">定員:{totalCapacity}名 / 予約済:{totalBooked}名</p>
                </div>
              </div>

              {/* プログレスメーター（中央部） */}
              <div className="flex-1 space-y-1.5">
                <div className="flex justify-between items-center text-[10px] font-black text-gray-600">
                  <span className="font-bold text-gray-400">予約埋まり度</span>
                  <span>{Math.round(bookingRate)}%</span>
                </div>
                
                {/* ゲージ本体 */}
                <div className="w-full h-3.5 bg-gray-200/80 rounded-full overflow-hidden p-0.5 border border-gray-300/40 shadow-inner">
                  <div 
                    className={`h-full rounded-full transition-all duration-1000 ${
                      bookingRate >= 100 
                        ? "bg-gray-400" 
                        : bookingRate >= 80 
                        ? "bg-[#E53E3E]" 
                        : bookingRate >= 50 
                        ? "bg-[#DD6B20]" 
                        : "bg-[#319795]"
                    }`}
                    style={{ width: `${Math.max(4, bookingRate)}%` }}
                  />
                </div>
              </div>

              {/* 予約の取りやすさステータス（右側） */}
              <div className="flex items-center justify-between md:justify-end gap-3 md:w-64 shrink-0 mt-2 md:mt-0 pt-2.5 md:pt-0 border-t md:border-t-0 border-gray-100">
                <div className={`px-2.5 py-1.5 rounded-xl border ${easeLevel.bgColor} ${easeLevel.borderColor} ${easeLevel.color} text-[10px] font-black flex items-center gap-1 flex-1 md:flex-initial text-center justify-center md:justify-start`}>
                  <LucideIcon name={easeLevel.icon} size={11} className="shrink-0" />
                  <span>{easeLevel.text}</span>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectBooth(booth.id)}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-black transition-all flex items-center gap-1 cursor-pointer shrink-0 ${
                    isSelected 
                      ? "bg-[#E53E3E] text-white border-2 border-[#E53E3E]" 
                      : remaining === 0
                      ? "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed"
                      : "bg-white text-gray-700 hover:bg-[#FFF5F5] border-2 border-gray-200 hover:border-[#E53E3E]"
                  }`}
                  disabled={remaining === 0 && !isSelected}
                >
                  {isSelected ? "選択中 🐾" : remaining === 0 ? "満員です" : "ブースを選ぶ"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 💡 コツのご案内 */}
      <div className="bg-[#FFF5F5] border-2 border-[#FED7D7] rounded-2xl p-3.5 text-[10px] text-[#742A2A] font-bold leading-relaxed flex gap-2">
        <div className="text-[#E53E3E] shrink-0 mt-0.5">
          <LucideIcon name="Lightbulb" size={13} />
        </div>
        <p>
          <strong>予約のコツ：</strong> 予約枠は毎分リアルタイムで同期されます。満員になっているブースでも、他の来場者がキャンセル手続きを行うと<strong>即座に空き枠が復活して予約可能</strong>になります！ぜひこまめにチェックしてみてください。🐾
        </p>
      </div>
    </div>
  );
}
