import React from "react";
import { AnimalBooth, TimeSlot } from "../types";
import LucideIcon from "./LucideIcon";

interface BoothCardProps {
  key?: React.Key;
  booth: AnimalBooth;
  slots: TimeSlot[];
  isSelected: boolean;
  onSelect: (boothId: string) => void;
}

export default function BoothCard({ booth, slots, isSelected, onSelect }: BoothCardProps) {
  // このブースに紐づくスロット情報から、空いているスロットの数などを計算
  const boothSlots = slots.filter(s => s.animalId === booth.id);
  const totalCapacity = boothSlots.reduce((acc, s) => acc + s.capacity, 0);
  const totalBooked = boothSlots.reduce((acc, s) => acc + (s.bookedCount || 0), 0);
  const totalRemaining = Math.max(0, totalCapacity - totalBooked);

  // アイコンの色
  const colorMap: Record<string, { bg: string, text: string, border: string, shadow: string, selectBorder: string, barColor: string }> = {
    dog1: { 
      bg: "bg-[#FED7D7] text-[#E53E3E]", 
      text: "text-[#E53E3E]", 
      border: "border-[#FED7D7]", 
      shadow: "shadow-[6px_6px_0px_#FED7D7]",
      selectBorder: "border-[#E53E3E]",
      barColor: "bg-[#E53E3E]"
    },
    dog2: { 
      bg: "bg-[#FEEBC8] text-[#DD6B20]", 
      text: "text-[#DD6B20]", 
      border: "border-[#FEEBC8]", 
      shadow: "shadow-[6px_6px_0px_#FEEBC8]",
      selectBorder: "border-[#DD6B20]",
      barColor: "bg-[#DD6B20]"
    },
    dog3: { 
      bg: "bg-[#FEFCBF] text-[#D69E2E]", 
      text: "text-[#D69E2E]", 
      border: "border-[#FEFCBF]", 
      shadow: "shadow-[6px_6px_0px_#FEFCBF]",
      selectBorder: "border-[#D69E2E]",
      barColor: "bg-[#D69E2E]"
    },
    cat: { 
      bg: "bg-[#E6FFFA] text-[#319795]", 
      text: "text-[#319795]", 
      border: "border-[#E6FFFA]", 
      shadow: "shadow-[6px_6px_0px_#E6FFFA]",
      selectBorder: "border-[#319795]",
      barColor: "bg-[#319795]"
    },
    small_animal: { 
      bg: "bg-[#FAF5FF] text-[#805AD5]", 
      text: "text-[#805AD5]", 
      border: "border-[#FAF5FF]", 
      shadow: "shadow-[6px_6px_0px_#FAF5FF]",
      selectBorder: "border-[#805AD5]",
      barColor: "bg-[#805AD5]"
    }
  };

  const style = colorMap[booth.id] || { 
    bg: "bg-gray-100 text-gray-600", 
    text: "text-gray-600", 
    border: "border-gray-100", 
    shadow: "shadow-[6px_6px_0px_#E2E8F0]",
    selectBorder: "border-gray-300",
    barColor: "bg-gray-500"
  };

  const bookingRate = totalCapacity > 0 ? (totalBooked / totalCapacity) * 100 : 0;

  return (
    <button
      onClick={() => onSelect(booth.id)}
      id={`booth-card-${booth.id}`}
      className={`w-full text-left p-5 rounded-[2rem] border-4 transition-all duration-200 pop-bounce flex flex-col justify-between h-full bg-white relative ${
        isSelected 
          ? `${style.selectBorder} shadow-[6px_6px_0px_#E53E3E] scale-[1.01]` 
          : "border-[#E2E8F0] hover:border-[#F6AD55] shadow-sm"
      }`}
    >
      {/* 選択マーク */}
      {isSelected && (
        <span className="absolute -top-3 -right-3 bg-[#E53E3E] text-white p-1 rounded-full border-2 border-white shadow-md animate-scale-in">
          <LucideIcon name="Check" size={16} />
        </span>
      )}

      <div className="space-y-3.5">
        {/* アイコンと名前 */}
        <div className="flex items-center space-x-3">
          <div className={`p-3 rounded-2xl ${style.bg} ${style.border} border-2 flex items-center justify-center shadow-inner`}>
            <LucideIcon name={booth.icon} size={28} />
          </div>
          <div>
            <h3 className="font-black text-[#2D3748] text-base md:text-lg tracking-tight">
              {booth.name}
            </h3>
            <span className="text-[10px] bg-[#FFF5F5] text-[#E53E3E] font-black px-2 py-0.5 rounded-full border border-[#FED7D7]">
              体験ブース
            </span>
          </div>
        </div>

        {/* ブース説明 */}
        <p className="text-xs text-gray-600 font-bold leading-relaxed">
          {booth.description}
        </p>

        {/* プログレスメーター（インライン） */}
        <div className="space-y-1.5 mt-4 w-full bg-gray-50/50 p-2.5 rounded-xl border border-gray-100">
          <div className="flex justify-between items-center text-[9px] font-black text-gray-500">
            <span>予約埋まり度</span>
            <span className={`${bookingRate >= 100 ? 'text-gray-400' : bookingRate >= 80 ? 'text-[#E53E3E]' : 'text-gray-700'}`}>{Math.round(bookingRate)}%</span>
          </div>
          <div className="w-full h-2 bg-gray-200/50 rounded-full overflow-hidden p-0.5 border border-gray-300/30 shadow-inner">
            <div 
              className={`h-full rounded-full transition-all duration-1000 ${
                bookingRate >= 100 
                  ? "bg-gray-400" 
                  : bookingRate >= 80 
                  ? "bg-[#E53E3E]" 
                  : bookingRate >= 50 
                  ? "bg-[#DD6B20]" 
                  : style.barColor
              }`}
              style={{ width: `${Math.max(5, bookingRate)}%` }}
            />
          </div>
        </div>
      </div>

      {/* 残り枠数サマリー */}
      <div className="mt-5 pt-3.5 border-t-2 border-dashed border-gray-100 flex items-center justify-between w-full">
        <span className="text-xs font-black text-gray-400">本日の残り予約枠</span>
        <div className="flex items-center space-x-1">
          {totalRemaining > 0 ? (
            <>
              <span className={`text-xl font-black ${style.text}`}>
                {totalRemaining}
              </span>
              <span className="text-xs font-black text-gray-500">名分</span>
            </>
          ) : (
            <span className="text-xs bg-gray-100 text-gray-400 font-black px-2.5 py-1 rounded-full">
              満員御礼 🐾
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
