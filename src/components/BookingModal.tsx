import React, { useState } from "react";
import { 
  collection, 
  doc, 
  runTransaction, 
  serverTimestamp,
  getDocs
} from "firebase/firestore";
import { db } from "../firebase";
import { TimeSlot, AnimalBooth, Reservation, Companion } from "../types";
import LucideIcon from "./LucideIcon";
import { generateTicketNumber } from "../utils";

interface BookingModalProps {
  selectedBooth: AnimalBooth;
  selectedSlot: TimeSlot;
  deviceToken: string;
  onClose: () => void;
  onSuccess: (newReservation: Reservation) => void;
}

export default function BookingModal({
  selectedBooth,
  selectedSlot,
  deviceToken,
  onClose,
  onSuccess
}: BookingModalProps) {
  const [userName, setUserName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("一般");
  const [partySize, setPartySize] = useState(1);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 同伴者数の変更ハンドラ
  const handlePartySizeChange = (size: number) => {
    setPartySize(size);
    const needed = size - 1;
    setCompanions(prev => {
      const next = [...prev];
      if (next.length < needed) {
        while (next.length < needed) {
          next.push({ name: "", phone: "" });
        }
      } else if (next.length > needed) {
        next.splice(needed);
      }
      return next;
    });
  };

  const handleCompanionChange = (index: number, field: keyof Companion, value: string) => {
    setCompanions(prev => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: value
      };
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setErrorMsg("");

    const trimmedName = userName.trim();
    const trimmedPhone = phone.trim().replace(/-/g, "");

    // バリデーション
    if (!trimmedName) {
      setErrorMsg("代表者のお名前を入力してください。");
      return;
    }
    if (!trimmedPhone) {
      setErrorMsg("代表者の電話番号を入力してください。");
      return;
    }
    if (!/^\d{10,11}$/.test(trimmedPhone)) {
      setErrorMsg("電話番号はハイフンなしの10桁または11桁の数字で入力してください。");
      return;
    }

    // 同行者バリデーション
    const cleanedCompanions: Companion[] = [];
    for (let i = 0; i < companions.length; i++) {
      const compName = companions[i].name.trim();
      const compPhone = companions[i].phone.trim().replace(/-/g, "");

      if (!compName) {
        setErrorMsg(`同行者 ${i + 1} のお名前を入力してください。`);
        return;
      }
      if (!compPhone) {
        setErrorMsg(`同行者 ${i + 1} の電話番号を入力してください。`);
        return;
      }
      if (!/^\d{10,11}$/.test(compPhone)) {
        setErrorMsg(`同行者 ${i + 1} の電話番号はハイフンなしの10桁または11桁の数字で入力してください。`);
        return;
      }
      cleanedCompanions.push({ name: compName, phone: compPhone });
    }

    setIsSubmitting(true);

    try {
      const gasApiUrl = localStorage.getItem("animal_fes_gas_api_url");
      if (gasApiUrl) {
        // --- 📊 Googleスプレッドシート連携モードでの予約処理 ---
        const response = await fetch(gasApiUrl, {
          method: "POST",
          mode: "cors",
          headers: {
            "Content-Type": "text/plain" // GAS CORS制約回避のためのtext/plain
          },
          body: JSON.stringify({
            action: "createReservation",
            data: {
              slotId: selectedSlot.id,
              userName: trimmedName,
              phone: trimmedPhone,
              relationship: relationship,
              partySize: partySize,
              companions: cleanedCompanions,
              deviceToken: deviceToken,
              isAdminAdded: false
            }
          })
        });

        const res = await response.json();
        if (!res.success) {
          throw new Error(res.error || "スプレッドシートへの予約に失敗しました。");
        }

        const newReservationData: Reservation = {
          id: res.id,
          slotId: selectedSlot.id,
          animalId: selectedBooth.id,
          userName: trimmedName,
          phone: trimmedPhone,
          relationship: relationship as any,
          partySize: partySize,
          companions: cleanedCompanions,
          status: "booked",
          ticketNumber: res.ticketNumber,
          deviceToken: deviceToken,
          createdAt: new Date()
        };

        onSuccess(newReservationData);
        return;
      }

      // --- 🔥 従来の Firebase (Firestore) モードでの予約処理 ---
      // 1. 重複予約チェック (名前または電話番号が代表者・同行者のいずれかと一致)
      const reservationsSnapshot = await getDocs(collection(db, "reservations"));
      
      let alreadyBooked = false;
      let duplicateInfo = "";

      reservationsSnapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data.status === "cancelled") return;

        // すでに登録されている全ての人名・電話番号
        const existingNames = [data.userName, ...(data.companions || []).map((c: any) => c.name)];
        const existingPhones = [data.phone, ...(data.companions || []).map((c: any) => c.phone)].filter(Boolean);

        // 代表者チェック
        if (existingNames.includes(trimmedName)) {
          alreadyBooked = true;
          duplicateInfo = `「${trimmedName}」様はすでに他で予約されています。`;
        }
        if (existingPhones.includes(trimmedPhone)) {
          alreadyBooked = true;
          duplicateInfo = `電話番号「${trimmedPhone}」はすでに登録されています。`;
        }

        // 同伴者チェック
        cleanedCompanions.forEach((c) => {
          if (existingNames.includes(c.name)) {
            alreadyBooked = true;
            duplicateInfo = `同行者「${c.name}」様はすでに他で予約されています。`;
          }
          if (existingPhones.includes(c.phone)) {
            alreadyBooked = true;
            duplicateInfo = `同行者の電話番号「${c.phone}」はすでに登録されています。`;
          }
        });
      });

      if (alreadyBooked) {
        throw new Error(`予約の上限を超えています。${duplicateInfo ? ` (${duplicateInfo})` : ""}`);
      }

      const slotRef = doc(db, "slots", selectedSlot.id);
      let newReservationData: any = null;

      // トランザクションで空きスロットの確認とインクリメントをアトミックに行う
      await runTransaction(db, async (transaction) => {
        const slotSnap = await transaction.get(slotRef);
        if (!slotSnap.exists()) {
          throw new Error("スロットデータが見つかりません。運営にお問い合わせください。");
        }

        const data = slotSnap.data();
        const latestBookedCount = data.bookedCount || 0;
        const capacity = data.capacity || 5;

        // 定員チェック
        if (latestBookedCount + partySize > capacity) {
          const remaining = Math.max(0, capacity - latestBookedCount);
          throw new Error(`ごめんなさい！タッチの差で満席または定員オーバーになりました。（この時間枠の残り枠数: ${remaining}名分）`);
        }

        // 新しい予約ドキュメントをトランザクション内で作成
        const resRef = doc(collection(db, "reservations"));
        const nextSequence = latestBookedCount + 1;
        const ticketNo = generateTicketNumber(selectedBooth.id, selectedSlot.startTime, nextSequence);

        newReservationData = {
          id: resRef.id,
          slotId: selectedSlot.id,
          animalId: selectedBooth.id,
          userName: trimmedName,
          phone: trimmedPhone,
          relationship: relationship,
          partySize: partySize,
          companions: cleanedCompanions,
          status: "booked",
          ticketNumber: ticketNo,
          deviceToken: deviceToken,
          createdAt: new Date()
        };

        // 予約の保存
        transaction.set(resRef, {
          ...newReservationData,
          createdAt: serverTimestamp()
        });

        // スロット側の予約数をカウントアップ (partySize分)
        transaction.update(slotRef, {
          bookedCount: latestBookedCount + partySize
        });
      });

      if (newReservationData) {
        onSuccess(newReservationData);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "予約中にエラーが発生しました。もう一度お試しください。");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-white rounded-[2.5rem] max-w-lg w-full p-6 shadow-[8px_8px_0px_#2D3748] border-4 border-[#E53E3E] relative my-8">
        
        {/* 閉じるボタン */}
        <button 
          onClick={onClose}
          id="btn-close-booking-modal"
          className="absolute top-5 right-5 text-gray-400 hover:text-gray-600 transition-colors bg-[#FFF5F5] hover:bg-[#FED7D7] p-1.5 rounded-full border-2 border-[#FED7D7]"
        >
          <LucideIcon name="X" size={20} />
        </button>

        <div className="text-center mb-5 mt-2">
          <span className="inline-block bg-[#FFF5F5] border-2 border-[#FED7D7] text-[#E53E3E] p-3 rounded-2xl mb-2.5 animate-bounce">
            <LucideIcon name="Heart" size={28} className="fill-[#E53E3E] stroke-[#E53E3E]" />
          </span>
          <h3 className="text-lg font-black text-[#E53E3E]">
            ふれあい体験を予約する 🐾
          </h3>
          <p className="text-xs text-gray-500 font-bold mt-1">
            整理券をリアルタイムで確保します。
          </p>
        </div>

        {/* 予約ターゲットの要約 */}
        <div className="bg-[#FFF5F5] border-2 border-[#FED7D7] rounded-3xl p-4 mb-5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-gray-500">体験ブース</span>
            <span className="text-xs bg-[#E53E3E] text-white font-black px-3 py-0.5 rounded-full">
              {selectedBooth.name}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-gray-500">体験時間</span>
            <span className="text-sm font-mono font-black text-[#E53E3E]">
              {selectedSlot.startTime}~{selectedSlot.endTime}
            </span>
          </div>
          <div className="flex items-center justify-between border-t-2 border-dashed border-[#FED7D7] pt-2.5 text-xs">
            <span className="text-gray-400 font-bold">※ 重複防止・まとめ取り防止</span>
            <span className="text-[#DD6B20] font-black">1人1回ずつの予約です</span>
          </div>
        </div>

        {/* フォーム */}
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* 代表者入力 */}
          <div className="bg-[#FFF5F5]/40 p-4 rounded-3xl border-2 border-dashed border-[#FED7D7] space-y-4">
            <h4 className="text-xs font-black text-[#E53E3E] flex items-center gap-1">
              <span>👤</span> 代表者さま情報
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-black text-gray-600 mb-1">
                  お名前（代表者）<span className="text-[#E53E3E] font-bold">*</span>
                </label>
                <input 
                  type="text" 
                  placeholder="例：山田 花子"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  maxLength={20}
                  required
                  className="w-full px-3.5 py-2 border-4 border-[#FED7D7] focus:border-[#F6AD55] focus:outline-none rounded-2xl font-black text-xs bg-white text-gray-800"
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label className="block text-[11px] font-black text-gray-600 mb-1">
                  電話番号（代表者）<span className="text-[#E53E3E] font-bold">*</span>
                </label>
                <input 
                  type="tel" 
                  placeholder="例：09012345678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={11}
                  required
                  className="w-full px-3.5 py-2 border-4 border-[#FED7D7] focus:border-[#F6AD55] focus:outline-none rounded-2xl font-black text-xs bg-white text-gray-800"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-black text-gray-600 mb-1">
                関係性<span className="text-[#E53E3E] font-bold">*</span>
              </label>
              <select
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                required
                className="w-full px-3.5 py-2 border-4 border-[#FED7D7] focus:border-[#F6AD55] focus:outline-none rounded-2xl font-black text-xs bg-white text-gray-800"
                disabled={isSubmitting}
              >
                <option value="一般">一般</option>
                <option value="学生">学生</option>
                <option value="学生保護者">学生保護者</option>
              </select>
            </div>
          </div>

          {/* 人数選択 */}
          <div className="bg-amber-50/20 p-4 rounded-3xl border-2 border-dashed border-amber-200 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-gray-700 flex items-center gap-1">
                <span>👥</span> 体験人数（2〜4人まで予約可能）<span className="text-[#E53E3E] font-bold">*</span>
              </label>
              <div className="flex items-center gap-1 bg-white p-1 rounded-2xl border-2 border-gray-100">
                {[1, 2, 3, 4].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handlePartySizeChange(num)}
                    className={`px-3 py-1 rounded-xl text-xs font-black transition-all ${
                      partySize === num
                        ? "bg-[#E53E3E] text-white"
                        : "text-gray-500 hover:bg-gray-100"
                    }`}
                    disabled={isSubmitting}
                  >
                    {num}人
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[10px] text-gray-500 font-bold leading-normal">
              ※ 代表者さまを含む全体の人数を選択してください。人数分の同行者情報をご入力いただけます。
            </p>
          </div>

          {/* 同行者入力フォーム */}
          {partySize > 1 && (
            <div className="bg-[#EBF8FF]/50 p-4 rounded-3xl border-2 border-dashed border-blue-200 space-y-4 animate-scale-in">
              <h4 className="text-xs font-black text-blue-600 flex items-center gap-1">
                <span>🐾</span> 同行者さま情報
              </h4>

              {companions.map((comp, idx) => (
                <div key={idx} className="p-3 bg-white rounded-2xl border border-blue-100 space-y-3">
                  <span className="text-[10px] bg-blue-50 text-blue-600 font-black px-2 py-0.5 rounded-full">
                    同行者 {idx + 1}
                  </span>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 mb-1">
                        お名前（フルネーム）<span className="text-[#E53E3E] font-bold">*</span>
                      </label>
                      <input 
                        type="text" 
                        placeholder={`例：山田 太郎`}
                        value={comp.name}
                        onChange={(e) => handleCompanionChange(idx, "name", e.target.value)}
                        maxLength={20}
                        required
                        className="w-full px-3 py-1.5 border-2 border-gray-200 focus:border-blue-400 focus:outline-none rounded-xl font-black text-xs bg-gray-50/50"
                        disabled={isSubmitting}
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-gray-500 mb-1">
                        電話番号（ハイフンなし）<span className="text-[#E53E3E] font-bold">*</span>
                      </label>
                      <input 
                        type="tel" 
                        placeholder={`例：09098765432`}
                        value={comp.phone}
                        onChange={(e) => handleCompanionChange(idx, "phone", e.target.value)}
                        maxLength={11}
                        required
                        className="w-full px-3 py-1.5 border-2 border-gray-200 focus:border-blue-400 focus:outline-none rounded-xl font-black text-xs bg-gray-50/50"
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {errorMsg && (
            <div className="bg-[#FFF5F5] border-2 border-[#FED7D7] text-[#E53E3E] text-xs font-black px-3 py-2.5 rounded-xl flex items-start gap-1.5 leading-relaxed">
              <LucideIcon name="AlertTriangle" size={16} className="shrink-0 text-[#E53E3E] mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              id="btn-cancel-booking"
              className="flex-1 bg-white text-gray-700 font-black py-3 rounded-2xl text-xs transition-all border-4 border-[#E2E8F0] border-b-8 hover:bg-gray-50 active:border-b-4 active:translate-y-[2px]"
              disabled={isSubmitting}
            >
              閉じる
            </button>
            <button
              type="submit"
              id="btn-confirm-booking"
              className="flex-[2] bg-[#E53E3E] hover:bg-[#C53030] text-white font-black py-3 rounded-2xl text-xs border-4 border-[#9B2C2C] border-b-8 hover:border-b-8 active:border-b-4 active:translate-y-[2px] shadow-sm flex items-center justify-center gap-1.5"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <LucideIcon name="RefreshCw" size={14} className="animate-spin" />
                  予約中...
                </>
              ) : (
                "予約を確定する 🎟️"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
