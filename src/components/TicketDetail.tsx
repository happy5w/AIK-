import React, { useState, useEffect } from "react";
import { doc, onSnapshot, runTransaction } from "firebase/firestore";
import { db } from "../firebase";
import { Reservation, AnimalBooth, TimeSlot } from "../types";
import LucideIcon from "./LucideIcon";

interface TicketDetailProps {
  reservation: Reservation;
  booth: AnimalBooth;
  slot: TimeSlot;
  onCancelSuccess: (reservationId: string) => void;
  onBookAnother: (slot: TimeSlot) => void; // グループ予約アシスタント用 (同じ枠で追加予約)
  simulatedTime?: { hour: number; minute: number }; // 模擬時間（15分前通知の連動用）
}

export default function TicketDetail({
  reservation: initialReservation,
  booth,
  slot: initialSlot,
  onCancelSuccess,
  onBookAnother,
  simulatedTime
}: TicketDetailProps) {
  const [reservation, setReservation] = useState<Reservation>(initialReservation);
  const [slot, setSlot] = useState<TimeSlot>(initialSlot);
  const [isCancelling, setIsCancelling] = useState(false);



  // リアルタイムに予約状態を同期
  useEffect(() => {
    const gasApiUrl = localStorage.getItem("animal_fes_gas_api_url");
    if (gasApiUrl) {
      // GASモードのときは、親からの Props (initialReservation, initialSlot) に従いステートを追従させる
      setReservation(initialReservation);
      setSlot(initialSlot);
      return;
    }

    // Firebaseモード時のリアルタイム購読
    const resRef = doc(db, "reservations", initialReservation.id);
    const unsubRes = onSnapshot(resRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setReservation({
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt?.toDate() || new Date()
        } as Reservation);
      }
    });

    const slotRef = doc(db, "slots", initialReservation.slotId);
    const unsubSlot = onSnapshot(slotRef, (docSnap) => {
      if (docSnap.exists()) {
        setSlot({
          id: docSnap.id,
          ...docSnap.data()
        } as TimeSlot);
      }
    });

    return () => {
      unsubRes();
      unsubSlot();
    };
  }, [initialReservation, initialSlot]);

  // チケットのキャンセル手続き (枠の復活と予約データの削除をアトミックに行う)
  const handleCancel = async () => {
    if (!window.confirm("本当にこの予約をキャンセルしますか？ (キャンセルすると時間枠が他の方に復活します)")) {
      return;
    }

    setIsCancelling(true);

    try {
      const gasApiUrl = localStorage.getItem("animal_fes_gas_api_url");
      if (gasApiUrl) {
        // --- 📊 Googleスプレッドシート連携モードでのキャンセル処理 ---
        const response = await fetch(gasApiUrl, {
          method: "POST",
          mode: "cors",
          headers: {
            "Content-Type": "text/plain"
          },
          body: JSON.stringify({
            action: "cancelReservation",
            id: reservation.id
          })
        });

        const res = await response.json();
        if (!res.success) {
          throw new Error(res.error || "スプレッドシートでのキャンセルに失敗しました。");
        }
      } else {
        // --- 🔥 従来の Firebase (Firestore) モードでのキャンセル処理 ---
        const slotRef = doc(db, "slots", reservation.slotId);
        const resRef = doc(db, "reservations", reservation.id);

        await runTransaction(db, async (transaction) => {
          const slotSnap = await transaction.get(slotRef);
          if (!slotSnap.exists()) throw new Error("時間枠が存在しません。");

          const currentBooked = slotSnap.data().bookedCount || 0;
          const pSize = reservation.partySize || 1;
          
          // 1. 予約をキャンセル状態に更新
          transaction.update(resRef, { status: "cancelled" });
          
          // 2. 予約枠のデクリメント
          transaction.update(slotRef, {
            bookedCount: Math.max(0, currentBooked - pSize)
          });
        });
      }

      // LocalStorage からこの予約を消去
      const localResJson = localStorage.getItem("animal_fes_reservations");
      if (localResJson) {
        try {
          const list = JSON.parse(localResJson) as Reservation[];
          const filtered = list.filter(r => r.id !== reservation.id);
          localStorage.setItem("animal_fes_reservations", JSON.stringify(filtered));
        } catch (e) {
          console.error("Error updating local storage list", e);
        }
      }
      // 念のため古いキーも削除
      localStorage.removeItem("animal_fes_my_reservation");

      setIsCancelling(false);
      onCancelSuccess(reservation.id);
    } catch (err) {
      console.error("キャンセル処理エラー:", err);
      alert("キャンセルに失敗しました。時間をおいてもう一度お試しください。");
      setIsCancelling(false);
    }
  };

  const remainingSlots = Math.max(0, slot.capacity - (slot.bookedCount || 0));

  return (
    <div className="max-w-md mx-auto my-6 space-y-6">
      
      {/* 予約証明チケット */}
      <div className="relative bg-white rounded-[2.5rem] overflow-hidden shadow-[8px_8px_0px_#2D3748] border-4 border-[#E53E3E] animate-scale-in">
        
        {/* チケットヘッダー */}
        <div className="bg-[#E53E3E] text-white px-6 py-5 text-center relative">
          <div className="absolute top-2 left-2 opacity-10">
            <LucideIcon name="Heart" size={40} className="fill-white" />
          </div>
          <p className="text-[10px] font-black tracking-widest text-[#FED7D7] uppercase">
            Animal School Festival entry ticket
          </p>
          <h2 className="text-lg font-black mt-1">
            どうぶつふれあい整理券 🎟️
          </h2>
        </div>

        {/* ギザギザ（切取り線）のCSSデザイン表現 */}
        <div className="flex justify-between items-center px-4 bg-[#E53E3E] relative">
          <div className="w-5 h-5 rounded-full bg-[#FFF5F5] -ml-7 z-10 border-r-2 border-[#E53E3E]"></div>
          <div className="border-t-4 border-dashed border-[#F6AD55] w-full"></div>
          <div className="w-5 h-5 rounded-full bg-[#FFF5F5] -mr-7 z-10 border-l-2 border-[#E53E3E]"></div>
        </div>

        {/* チケットボディー */}
        <div className="p-6 space-y-5 bg-white">
          
          {/* 整理券番号 */}
          <div className="text-center space-y-1">
            <span className="text-[10px] text-gray-400 font-black uppercase tracking-wider">
              整理券番号 (提示用)
            </span>
            <div className="text-3xl font-mono font-black text-[#E53E3E] tracking-wider">
              {reservation.ticketNumber}
            </div>
          </div>

          {/* 状態ステータスバー */}
          <div className="flex justify-center">
            {reservation.status === "checked_in" ? (
              <div className="bg-[#E6FFFA] border-2 border-[#319795] text-[#319795] text-xs font-black px-4 py-2 rounded-full flex items-center gap-1.5 shadow-sm">
                <LucideIcon name="CheckCircle" size={16} /> 受付完了！おもいっきり楽しんでね 🐾
              </div>
            ) : (
              <div className="bg-[#FFF5F5] border-2 border-[#FED7D7] text-[#E53E3E] text-xs font-black px-4 py-2 rounded-full flex items-center gap-1.5 animate-pulse">
                <LucideIcon name="Clock" size={16} /> 現地ブースでこの画面を見せてね
              </div>
            )}
          </div>

          <div className="border-t-2 border-b-2 border-dashed border-[#FED7D7] py-4 space-y-3.5">
            {/* お名前 */}
            <div className="flex justify-between items-center">
              <span className="text-xs font-black text-gray-400">代表者名</span>
              <span className="text-sm font-black text-[#2D3748]">{reservation.userName} 様</span>
            </div>

            {/* 人数・パーティーサイズ */}
            <div className="flex justify-between items-center">
              <span className="text-xs font-black text-gray-400">体験人数</span>
              <span className="text-xs bg-amber-50 text-amber-700 font-black px-2.5 py-0.5 rounded-full border border-amber-200">
                {reservation.partySize || 1} 名
              </span>
            </div>

            {/* 同行者一覧 */}
            {reservation.companions && reservation.companions.length > 0 && (
              <div className="bg-gray-50 p-2.5 rounded-2xl border border-gray-100 text-[10px] space-y-1 text-gray-600 font-bold">
                <span className="text-[9px] text-gray-400 block font-black">同行者さま:</span>
                {reservation.companions.map((c, i) => (
                  <div key={i} className="flex justify-between">
                    <span>{c.name} 様</span>
                    <span className="font-mono text-gray-400">({c.phone})</span>
                  </div>
                ))}
              </div>
            )}

            {/* 電話番号 */}
            {reservation.phone && (
              <div className="flex justify-between items-center">
                <span className="text-xs font-black text-gray-400">電話番号</span>
                <span className="text-sm font-mono font-bold text-gray-700">
                  {reservation.phone.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3")}
                </span>
              </div>
            )}

            {/* 関係性 */}
            {reservation.relationship && (
              <div className="flex justify-between items-center">
                <span className="text-xs font-black text-gray-400">関係性</span>
                <span className="text-xs bg-[#EDF2F7] text-gray-700 font-black px-2.5 py-0.5 rounded-full border border-gray-200">
                  {reservation.relationship}
                </span>
              </div>
            )}

            {/* 体験ブース */}
            <div className="flex justify-between items-center">
              <span className="text-xs font-black text-gray-400">体験ブース</span>
              <span className="text-xs bg-[#FFF5F5] text-[#E53E3E] font-black px-3 py-1 rounded-full border border-[#FED7D7] flex items-center gap-1">
                <LucideIcon name={booth.icon} size={12} /> {booth.name}
              </span>
            </div>

            {/* 体験時間 */}
            <div className="flex justify-between items-center">
              <span className="text-xs font-black text-gray-400">体験時間</span>
              <span className="text-sm font-mono font-black text-[#E53E3E]">
                {slot.startTime}~{slot.endTime}
              </span>
            </div>
          </div>



          {/* スクショ推奨の優しいアナウンス */}
          <div className="bg-[#FFF5F5] rounded-2xl p-4 border-2 border-[#FED7D7] flex items-start gap-2.5 text-xs text-[#742A2A] leading-relaxed font-bold">
            <div className="text-[#E53E3E] mt-0.5 shrink-0">
              <LucideIcon name="Smartphone" size={16} />
            </div>
            <div>
              <strong className="font-black text-rose-950">📸 スクショを保存してください！</strong>
              <br />
              電波状況が悪くなることも考慮し、この画面を<span className="underline font-black text-[#E53E3E]">スクリーンショット（保存）</span>して、現地ブースの受付に見せていただければ、電波がなくても体験できます！
            </div>
          </div>
        </div>

        {/* チケットフッター (飾り切り切り) */}
        <div className="bg-[#FFF5F5] py-4 px-6 border-t-2 border-dashed border-[#FED7D7] flex items-center justify-between">
          <span className="text-[10px] text-gray-400 font-black">どうぶつ専門学校 学園祭事務局</span>
          <span className="text-[10px] text-[#E53E3E] font-black">THANK YOU 🐾</span>
        </div>
      </div>

      {/* グループ用：連続予約の提案アシスタント */}
      {reservation.status !== "checked_in" && (
        <div className="bg-white rounded-[2rem] p-5 shadow-md border-4 border-[#FED7D7] space-y-4">
          <div className="flex items-start gap-2.5">
            <div className="p-2 bg-[#FFF5F5] text-[#E53E3E] rounded-xl mt-0.5">
              <LucideIcon name="Users" size={18} />
            </div>
            <div>
              <h4 className="text-sm font-black text-[#2D3748]">
                👥 グループで一緒に体験される方へ
              </h4>
              <p className="text-xs text-gray-500 font-bold mt-0.5">
                お友達やご家族の分も同じスロットで予約をしますか？1名ずつ名前を分けて続けて確保できます。
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between bg-[#FFF5F5] p-3 rounded-2xl border-2 border-[#FED7D7]">
            <span className="text-xs text-gray-500 font-bold">同じ時間の空き数:</span>
            <span className="text-xs font-black text-[#E53E3E]">
              あと {remainingSlots} 席 予約可能
            </span>
          </div>

          <button
            onClick={() => onBookAnother(slot)}
            disabled={remainingSlots <= 0}
            id="btn-group-book-another"
            className={`w-full font-black py-3 rounded-2xl text-xs shadow-sm pop-bounce flex items-center justify-center gap-1.5 border-4 transition-all ${
              remainingSlots > 0 
                ? "bg-[#F6AD55] border-[#DD6B20] text-white border-b-8 hover:border-b-8 active:border-b-4 active:translate-y-[2px]" 
                : "bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed"
            }`}
          >
            <LucideIcon name="ChevronRight" size={14} /> 
            同じ時間枠で、もう1人の分を予約する🐾
          </button>
        </div>
      )}

      {/* キャンセル手続き */}
      <div className="text-center">
        <button
          onClick={handleCancel}
          disabled={isCancelling}
          id="btn-cancel-ticket"
          className="text-xs font-bold text-gray-400 hover:text-[#E53E3E] transition-colors inline-flex items-center gap-1 p-2"
        >
          {isCancelling ? (
            <>
              <LucideIcon name="RefreshCw" className="animate-spin" size={12} />
              キャンセル処理中...
            </>
          ) : (
            <>
              <LucideIcon name="Trash2" size={12} />
              整理券をキャンセルして枠を開放する
            </>
          )}
        </button>
      </div>

    </div>
  );
}
