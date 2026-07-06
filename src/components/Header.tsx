import React from "react";
import { Sparkles, Heart } from "lucide-react";

interface HeaderProps {
  onAdminClick: () => void;
  isAdminMode: boolean;
  onHomeClick?: () => void;
}

export default function Header({ onAdminClick, isAdminMode, onHomeClick }: HeaderProps) {
  return (
    <header className="relative overflow-hidden bg-[#E53E3E] text-white shadow-lg">
      {/* 背景の可愛いドットやストライプ模様のシミュレーション */}
      <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]"></div>
      
      <div className="max-w-4xl mx-auto px-4 py-5 flex items-center justify-between relative z-10">
        <div 
          className="flex items-center space-x-3.5 cursor-pointer select-none hover:opacity-90 active:scale-98 transition-all" 
          onClick={onHomeClick}
          title="予約ホームに戻る"
        >
          <div className="bg-white text-[#E53E3E] w-14 h-14 rounded-full border-4 border-[#F6AD55] shadow-md flex items-center justify-center animate-bounce">
            <Heart size={26} className="fill-[#E53E3E] stroke-[#E53E3E]" />
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="text-[10px] bg-[#C53030] text-white font-black px-2 py-0.5 rounded-full tracking-wider uppercase">
                学園祭イベント
              </span>
              <span className="text-[10px] bg-[#F6AD55] text-white font-black px-2 py-0.5 rounded-full flex items-center gap-0.5">
                <Sparkles size={10} /> リアルタイム
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-black tracking-tight mt-1 drop-shadow-[0_2px_2px_rgba(0,0,0,0.3)]">
              どうぶつふれあい体験予約 🐾
            </h1>
          </div>
        </div>

        <button 
          onClick={onAdminClick}
          id="btn-toggle-admin-mode"
          className={`px-4 py-2 rounded-full text-xs font-black transition-all flex items-center gap-1 shadow-md border-b-4 active:border-b-0 active:translate-y-[2px] ${
            isAdminMode 
              ? "bg-[#F6AD55] text-white border-[#DD6B20] hover:bg-[#ED8936]" 
              : "bg-white text-[#E53E3E] border-gray-200 hover:bg-gray-50"
          }`}
        >
          {isAdminMode ? "🙋 来場者画面へ" : "🔒 スタッフ専用"}
        </button>
      </div>

      {/* 赤メインのアクセントライン */}
      <div className="h-1.5 bg-[#F6AD55] w-full"></div>
    </header>
  );
}
