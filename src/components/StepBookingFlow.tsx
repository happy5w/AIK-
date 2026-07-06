import React, { useState, useEffect } from "react";
import { 
  collection, 
  doc, 
  runTransaction, 
  serverTimestamp,
  getDocs,
  setDoc,
  getDoc
} from "firebase/firestore";
import { db } from "../firebase";
import { TimeSlot, AnimalBooth, Reservation, Companion, SystemSettings } from "../types";
import LucideIcon from "./LucideIcon";
import { generateTicketNumber } from "../utils";

const INITIAL_BOOTHS_FALLBACK: AnimalBooth[] = [
  {
    id: "dog1",
    name: "犬1 🐾",
    description: "人懐っこくて元気いっぱいなワンちゃん1号！なでなでおやつ体験もできるよ。",
    icon: "Dog",
    color: "bg-[#FFF5F5]"
  },
  {
    id: "dog2",
    name: "犬2 🐕",
    description: "おっとりマイペースで癒やし系なワンちゃん2号。優しくなでてあげてね。",
    icon: "Dog",
    color: "bg-[#FFFAF0]"
  },
  {
    id: "dog3",
    name: "犬3 🐩",
    description: "お利口さんで遊びが大好きなワンちゃん3号。お友達になろう！",
    icon: "Dog",
    color: "bg-[#FFFFF0]"
  },
  {
    id: "cat",
    name: "ねこ 🐱",
    description: "気まぐれで愛らしいねこちゃんたち。のんびり自由な時間を過ごそう。",
    icon: "Cat",
    color: "bg-[#E6FFFA]"
  },
  {
    id: "small_animal",
    name: "小動物 🐹",
    description: "うさぎやハムスターなど、ちいさくて可愛い動物たちと触れ合えるよ。",
    icon: "Rabbit",
    color: "bg-[#FAF5FF]"
  }
];

interface StepBookingFlowProps {
  booths: AnimalBooth[];
  slots: TimeSlot[];
  systemSettings: SystemSettings | null;
  deviceToken: string;
  simulatedTime: { hour: number; minute: number };
  onSuccess: (newReservation: Reservation) => void;
  gasApiUrl: string;
}

type Step = "intro" | "select_animal" | "select_time" | "input_info" | "confirm" | "completed";

export default function StepBookingFlow({
  booths,
  slots,
  systemSettings,
  deviceToken,
  simulatedTime,
  onSuccess,
  gasApiUrl
}: StepBookingFlowProps) {
  const [currentStep, setCurrentStep] = useState<Step>("intro");
  
  // 選択データ
  const [selectedBoothId, setSelectedBoothId] = useState<string>("");
  const [selectedSlotId, setSelectedSlotId] = useState<string>("");
  
  // 入力データ
  const [userName, setUserName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("一般");
  const [partySize, setPartySize] = useState(1);
  const [companions, setCompanions] = useState<Companion[]>([]);
  
  const [errorMsg, setErrorMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdReservation, setCreatedReservation] = useState<Reservation | null>(null);
  const [completedBoothInfo, setCompletedBoothInfo] = useState<{ id: string; name: string } | null>(null);
  const [completedSlotInfo, setCompletedSlotInfo] = useState<{ startTime: string; endTime: string } | null>(null);

  // すべての入力状態をリセットして、最初のイントロ画面(予約ホーム)に戻る
  const handleResetToHome = () => {
    setSelectedBoothId("");
    setSelectedSlotId("");
    setUserName("");
    setPhone("");
    setRelationship("一般");
    setPartySize(1);
    setCompanions([]);
    setErrorMsg("");
    setCreatedReservation(null);
    setCompletedBoothInfo(null);
    setCompletedSlotInfo(null);
    setCurrentStep("intro");
  };

  // どうぶつリスト（フォールバック付き）
  const displayBooths = booths && booths.length > 0 ? booths : INITIAL_BOOTHS_FALLBACK;

  // どうぶつ選択時の補助
  const selectedBooth = displayBooths.find(b => b.id === selectedBoothId);
  
  // 選択されたブースに対応するスロット（フォールバック付き）
  let filteredSlots = slots.filter(s => s.animalId === selectedBoothId);
  if (filteredSlots.length === 0 && selectedBoothId) {
    const times = [
      { start: "11:00", end: "11:30" },
      { start: "11:30", end: "12:00" },
      { start: "12:00", end: "12:30" },
      { start: "12:30", end: "13:00" },
      { start: "13:00", end: "13:30" },
      { start: "13:30", end: "14:00" }
    ];
    filteredSlots = times.map((t, idx) => ({
      id: `${selectedBoothId}_slot_${idx}`,
      animalId: selectedBoothId,
      startTime: t.start,
      endTime: t.end,
      capacity: 5,
      bookedCount: 0
    }));
  }

  const selectedSlot = slots.find(s => s.id === selectedSlotId) || filteredSlots.find(s => s.id === selectedSlotId);

  // 同伴者数の変更
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

  // 1. 動物選択完了 -> 時間選択ステップへ
  const handleSelectAnimal = (boothId: string) => {
    setSelectedBoothId(boothId);
    setSelectedSlotId(""); // 前の選択をクリア
    setErrorMsg("");
    setCurrentStep("select_time");
  };

  // 2. 時間枠選択完了 -> 情報入力ステップへ
  const handleSelectSlot = (slotId: string) => {
    if (systemSettings && !systemSettings.isBookingOpen) {
      alert("只今、オンライン新規予約の受付を一時停止しております。");
      return;
    }
    setSelectedSlotId(slotId);
    setErrorMsg("");
    setCurrentStep("input_info");
  };

  // 3. 情報入力完了 -> 最終確認へ
  const handleInfoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    const trimmedName = userName.trim();
    const trimmedPhone = phone.trim().replace(/-/g, "");

    if (!trimmedName) {
      setErrorMsg("お名前を入力してください。");
      return;
    }
    if (!trimmedPhone) {
      setErrorMsg("電話番号を入力してください。");
      return;
    }
    if (!/^\d{10,11}$/.test(trimmedPhone)) {
      setErrorMsg("電話番号はハイフンなしの10桁または11桁の数字で入力してください。");
      return;
    }

    // 同行者チェック
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
        setErrorMsg(`同行者 ${i + 1} の電話番号は10桁または11桁の数字で入力してください。`);
        return;
      }
    }

    setCurrentStep("confirm");
  };

  // 4. 予約確定処理 (Firebase or GAS)
  const handleConfirmBooking = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMsg("");

    if (systemSettings && !systemSettings.isBookingOpen) {
      setErrorMsg("只今、オンライン新規予約の受付を一時停止しております。");
      setIsSubmitting(false);
      return;
    }

    if (!selectedBooth || !selectedSlot) {
      setErrorMsg("選択した情報に不備があります。最初からやり直してください。");
      setIsSubmitting(false);
      return;
    }

    const trimmedName = userName.trim();
    const trimmedPhone = phone.trim().replace(/-/g, "");
    const cleanedCompanions = companions.map(c => ({
      name: c.name.trim(),
      phone: c.phone.trim().replace(/-/g, "")
    }));

    try {
      if (gasApiUrl) {
        // --- 📊 Googleスプレッドシート連携モードでの予約処理 ---
        const response = await fetch(gasApiUrl, {
          method: "POST",
          mode: "cors",
          headers: {
            "Content-Type": "text/plain"
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

        if (selectedBooth && selectedSlot) {
          setCompletedBoothInfo({ id: selectedBooth.id, name: selectedBooth.name });
          setCompletedSlotInfo({ startTime: selectedSlot.startTime, endTime: selectedSlot.endTime });
        }
        setCreatedReservation(newReservationData);
        setCurrentStep("completed");
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
        throw new Error(`重複予約はできません。${duplicateInfo ? ` (${duplicateInfo})` : ""}`);
      }

      const slotRef = doc(db, "slots", selectedSlot.id);
      let newReservationData: any = null;

      // トランザクションで空きスロットの確認とインクリメント
      await runTransaction(db, async (transaction) => {
        const slotSnap = await transaction.get(slotRef);
        let latestBookedCount = 0;
        let capacity = 5;

        if (!slotSnap.exists()) {
          // スロットが存在しない場合（フォールバックで仮生成された枠など）
          transaction.set(slotRef, {
            id: selectedSlot.id,
            animalId: selectedBooth.id,
            startTime: selectedSlot.startTime,
            endTime: selectedSlot.endTime,
            capacity: 5,
            bookedCount: 0
          });
        } else {
          const data = slotSnap.data();
          latestBookedCount = data.bookedCount || 0;
          capacity = data.capacity || 5;
        }

        // 定員チェック
        if (latestBookedCount + partySize > capacity) {
          const remaining = Math.max(0, capacity - latestBookedCount);
          throw new Error(`ごめんなさい！タッチの差で満席または定員オーバーになりました。（この時間枠の残り枠数: ${remaining}名分）`);
        }

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

        // スロット側のカウントアップ
        transaction.update(slotRef, {
          bookedCount: latestBookedCount + partySize
        });
      });

      if (newReservationData) {
        if (selectedBooth && selectedSlot) {
          setCompletedBoothInfo({ id: selectedBooth.id, name: selectedBooth.name });
          setCompletedSlotInfo({ startTime: selectedSlot.startTime, endTime: selectedSlot.endTime });
        }
        setCreatedReservation(newReservationData);
        setCurrentStep("completed");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "予約中にエラーが発生しました。もう一度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 各どうぶつの可愛い絵文字と色、追加説明
  const getAnimalMeta = (id: string) => {
    switch (id) {
      case "dog1":
        return { emoji: "🐾", text: "元気なわんこ1号", color: "bg-[#FFF5F5]", border: "border-[#FEB7B7]", textCol: "text-[#E53E3E]", activeBorder: "border-[#E53E3E] bg-[#FFF5F5]" };
      case "dog2":
        return { emoji: "🐕", text: "おっとりわんこ2号", color: "bg-[#FFFAF0]", border: "border-[#FEEBC8]", textCol: "text-[#DD6B20]", activeBorder: "border-[#DD6B20] bg-[#FFFAF0]" };
      case "dog3":
        return { emoji: "🐩", text: "なつっこいわんこ3号", color: "bg-[#FFFFF0]", border: "border-[#FEFCBF]", textCol: "text-[#D69E2E]", activeBorder: "border-[#D69E2E] bg-[#FFFFF0]" };
      case "cat":
        return { emoji: "🐱", text: "気まぐれにゃんこ", color: "bg-[#E6FFFA]", border: "border-[#81E6D9]", textCol: "text-[#319795]", activeBorder: "border-[#319795] bg-[#E6FFFA]" };
      case "small_animal":
        return { emoji: "🐹", text: "ちいさな小動物たち", color: "bg-[#FAF5FF]", border: "border-[#D6BCFA]", textCol: "text-[#805AD5]", activeBorder: "border-[#805AD5] bg-[#FAF5FF]" };
      default:
        return { emoji: "🐾", text: "かわいいどうぶつ", color: "bg-white", border: "border-gray-200", textCol: "text-gray-700", activeBorder: "border-red-500" };
    }
  };

  // 時間枠の空き状況から表示を設定
  const getSlotAvailability = (slot: TimeSlot) => {
    const remaining = slot.capacity - slot.bookedCount;
    if (remaining <= 0) {
      return { label: "満席 満員御礼 🔴", disabled: true, textClass: "text-red-500 bg-red-50" };
    } else if (remaining <= 2) {
      return { label: `残りわずか (あと${remaining}名) 🟡`, disabled: false, textClass: "text-amber-600 bg-amber-50" };
    } else {
      return { label: `空きあり (あと${remaining}名) 🟢`, disabled: false, textClass: "text-emerald-600 bg-emerald-50" };
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto space-y-6">
      
      {/* 🏠 どのステップからでも「予約ホーム」へ簡単に戻れる「ホーム（🏠）」ボタン */}
      {currentStep !== "intro" && (
        <div className="flex justify-start">
          <button
            type="button"
            onClick={handleResetToHome}
            className="bg-white hover:bg-[#FFF5F5] text-[#E53E3E] font-black px-4 py-2 rounded-2xl text-xs shadow-sm border-2 border-[#FED7D7] transition-all hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-1.5"
            title="予約ホームに戻る"
          >
            <span>🏠</span>
            <span>予約ホーム (最初に戻る)</span>
          </button>
        </div>
      )}
      
      {/* ステップナビゲーション（進捗バー） */}
      {currentStep !== "intro" && currentStep !== "completed" && (
        <div className="bg-white rounded-3xl p-4 border-4 border-[#FED7D7] shadow-sm">
          <div className="flex items-center justify-between text-xs font-black text-gray-400">
            <span className={currentStep === "select_animal" ? "text-[#E53E3E]" : "text-gray-500"}>1. どうぶつ</span>
            <span className="text-[#FED7D7]">▶</span>
            <span className={currentStep === "select_time" ? "text-[#E53E3E]" : "text-gray-500"}>2. じかん</span>
            <span className="text-[#FED7D7]">▶</span>
            <span className={currentStep === "input_info" ? "text-[#E53E3E]" : "text-gray-500"}>3. あなたの情報</span>
            <span className="text-[#FED7D7]">▶</span>
            <span className={currentStep === "confirm" ? "text-[#E53E3E]" : "text-gray-500"}>4. かくにん</span>
          </div>
          {/* 進捗ゲージ */}
          <div className="w-full bg-gray-100 h-2.5 rounded-full mt-2.5 overflow-hidden">
            <div 
              className="bg-[#E53E3E] h-full transition-all duration-300 rounded-full"
              style={{
                width: 
                  currentStep === "select_animal" ? "25%" : 
                  currentStep === "select_time" ? "50%" : 
                  currentStep === "input_info" ? "75%" : "100%"
              }}
            ></div>
          </div>
        </div>
      )}

      {/* 🚀 STEP 0: イントロ（ふれあいたい動物を選ぶ ボタン） */}
      {currentStep === "intro" && (
        <div className="text-center py-6 space-y-6 animate-scale-in">
          <div className="inline-block relative">
            <div className="absolute inset-0 bg-[#E53E3E] opacity-10 rounded-full blur-xl scale-125 animate-pulse"></div>
            <span className="relative text-7xl inline-block animate-bounce" style={{ animationDuration: "2.5s" }}>🐶🐱🐰🐹</span>
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <h3 className="text-xl font-black text-gray-800">
              ふれあい体験を予約しよう！🐾
            </h3>
            <p className="text-xs text-gray-500 font-bold leading-relaxed">
              オンライン整理券なら、スマホでかんたんにご予約いただけます。
              お好きなどうぶつ、時間を選んで今すぐ体験枠を確保しましょう！
            </p>
          </div>

          <button
            type="button"
            onClick={() => setCurrentStep("select_animal")}
            className="w-full max-w-md mx-auto bg-[#E53E3E] hover:bg-[#C53030] text-white text-base font-black px-8 py-5 rounded-[2rem] border-4 border-[#9B2C2C] border-b-[12px] active:border-b-4 active:translate-y-[8px] transition-all flex items-center justify-center gap-3 shadow-[0_8px_0_#9B2C2C,0_15px_20px_rgba(229,62,62,0.15)] cursor-pointer"
          >
            ふれあいたい動物を選ぶ 🐾
          </button>
        </div>
      )}

      {/* 🐾 STEP 1: どうぶつを選ぶ */}
      {currentStep === "select_animal" && (
        <div className="space-y-4 animate-fade-in">
          <div className="text-center space-y-1">
            <span className="text-xs bg-[#FFF5F5] border-2 border-[#FED7D7] text-[#E53E3E] font-black px-3.5 py-1 rounded-full">
              STEP 1 / 4
            </span>
            <h3 className="text-lg font-black text-gray-800 mt-1.5">
              どのどうぶつとふれあいたい？✨
            </h3>
            <p className="text-[11px] text-gray-500 font-bold">
              ふれあいたいどうぶつを1つタッチしてね！
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {displayBooths.map((booth) => {
              const meta = getAnimalMeta(booth.id);
              // シンプルでかわいい名前の決定
              const simpleName = booth.id === "dog1" ? "犬1 🐾" :
                                 booth.id === "dog2" ? "犬2 🐕" :
                                 booth.id === "dog3" ? "犬3 🐩" :
                                 booth.id === "cat" ? "ねこ 🐱" :
                                 booth.id === "small_animal" ? "小動物 🐹" : booth.name;
              return (
                <button
                  key={booth.id}
                  type="button"
                  onClick={() => handleSelectAnimal(booth.id)}
                  className={`p-5 rounded-[2rem] border-4 text-left transition-all active:scale-95 duration-200 cursor-pointer shadow-sm relative overflow-hidden group hover:shadow-md ${meta.color} ${meta.border} hover:border-[#F6AD55]`}
                >
                  {/* 背景の肉球マーク装飾 */}
                  <div className="absolute -bottom-6 -right-6 text-gray-200/20 text-8xl font-black select-none pointer-events-none group-hover:scale-110 transition-transform">🐾</div>
                  
                  <div className="flex items-center gap-4 relative z-10">
                    <span className="text-5xl bg-white p-3.5 rounded-2xl border-2 border-dashed border-gray-100 shadow-inner block transform group-hover:rotate-12 transition-transform animate-pulse">
                      {meta.emoji}
                    </span>
                    <div className="space-y-1 flex-1">
                      <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full bg-white border ${meta.textCol} border-current inline-block`}>
                        {meta.text}
                      </span>
                      <h4 className="text-base font-black text-gray-800 leading-tight">
                        {simpleName}
                      </h4>
                      <p className="text-[10px] text-gray-500 font-bold leading-relaxed line-clamp-2">
                        {booth.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => setCurrentStep("intro")}
              className="text-xs text-gray-500 font-bold hover:underline flex items-center justify-center gap-1.5 mx-auto cursor-pointer"
            >
              <LucideIcon name="ArrowLeft" size={12} />
              最初に戻る 🐾
            </button>
          </div>
        </div>
      )}

      {/* 🕒 STEP 2: 時間帯を選ぶ (11:00〜14:00、30分刻み) */}
      {currentStep === "select_time" && selectedBooth && (
        <div className="space-y-4 animate-fade-in">
          <div className="text-center space-y-1">
            <span className="text-xs bg-[#FFF5F5] border-2 border-[#FED7D7] text-[#E53E3E] font-black px-3.5 py-1 rounded-full">
              STEP 2 / 4
            </span>
            <h3 className="text-lg font-black text-gray-800 mt-1.5 flex items-center justify-center gap-1.5">
              <span>{getAnimalMeta(selectedBooth.id).emoji}</span>
              {selectedBooth.name.split(" ")[0]} のふれあい時間
            </h3>
            <p className="text-[11px] text-gray-500 font-bold">
              11:00~14:00 の間で、ご希望の時間枠をタッチしてね！
            </p>
          </div>

          {/* 選択中のどうぶつ要約 */}
          <div className="bg-[#FFF5F5] border-2 border-[#FED7D7] rounded-3xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-3xl bg-white p-1 rounded-xl shadow-inner border border-gray-100">
                {getAnimalMeta(selectedBooth.id).emoji}
              </span>
              <div>
                <p className="text-[10px] text-gray-400 font-bold">選択中のどうぶつ</p>
                <p className="text-xs font-black text-gray-800">{selectedBooth.name}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCurrentStep("select_animal")}
              className="text-[10px] bg-white text-gray-600 font-black px-3 py-1.5 rounded-xl border-2 border-gray-200 hover:bg-gray-50"
            >
              どうぶつを変更 🔄
            </button>
          </div>

          {/* スロットリスト */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredSlots.map((slot) => {
              const availability = getSlotAvailability(slot);
              
              // 模擬時間に基づく開始時間・終了時間の判定（過去のスロットは灰色に）
              const [startH, startM] = slot.startTime.split(":").map(Number);
              const isPast = (simulatedTime.hour > startH) || (simulatedTime.hour === startH && simulatedTime.minute > startM);
              
              const isDisabled = availability.disabled || isPast;

              return (
                <button
                  key={slot.id}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => handleSelectSlot(slot.id)}
                  className={`p-4 rounded-3xl border-4 text-left transition-all duration-200 cursor-pointer flex flex-col justify-between h-[85px] relative overflow-hidden active:scale-95 ${
                    isPast
                      ? "bg-gray-100/50 border-gray-200 text-gray-400 cursor-not-allowed opacity-60"
                      : isDisabled
                      ? "bg-red-50/20 border-red-100 text-gray-400 cursor-not-allowed"
                      : "bg-white border-[#FED7D7] hover:border-[#F6AD55] text-gray-800 shadow-sm hover:shadow-md"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm font-mono font-black tracking-tight flex items-center gap-1">
                      <LucideIcon name="Clock" size={13} className="text-gray-400" />
                      {slot.startTime}~{slot.endTime}
                    </span>
                    {isPast && (
                      <span className="text-[9px] bg-gray-200 text-gray-500 font-black px-2 py-0.5 rounded-full">
                        終了
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between w-full mt-2">
                    <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${isPast ? "bg-gray-100 text-gray-400" : availability.textClass}`}>
                      {isPast ? "体験時間が過ぎています" : availability.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => setCurrentStep("select_animal")}
              className="text-xs text-gray-500 font-bold hover:underline flex items-center justify-center gap-1.5 mx-auto"
            >
              <LucideIcon name="ArrowLeft" size={12} />
              前のステップに戻る
            </button>
          </div>
        </div>
      )}

      {/* 👤 STEP 3: お客様情報（お名前・電話番号入力） */}
      {currentStep === "input_info" && selectedBooth && selectedSlot && (
        <div className="space-y-4 animate-fade-in">
          <div className="text-center space-y-1">
            <span className="text-xs bg-[#FFF5F5] border-2 border-[#FED7D7] text-[#E53E3E] font-black px-3.5 py-1 rounded-full">
              STEP 3 / 4
            </span>
            <h3 className="text-lg font-black text-gray-800 mt-1.5">
              整理券にのせるおなまえを教えてね！🎟️
            </h3>
            <p className="text-[11px] text-gray-500 font-bold">
              代表者様のお名前とご連絡先、体験人数をご入力ください。
            </p>
          </div>

          {/* これまでの要約 */}
          <div className="bg-[#FFF5F5] border-2 border-[#FED7D7] rounded-3xl p-4 grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">
                {getAnimalMeta(selectedBooth.id).emoji}
              </span>
              <div>
                <p className="text-[9px] text-gray-400 font-bold">体験どうぶつ</p>
                <p className="text-xs font-black text-gray-800">{selectedBooth.name.split(" ")[0]}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 border-l-2 border-dashed border-[#FED7D7] pl-4">
              <div className="text-gray-400 mt-0.5 shrink-0">
                <LucideIcon name="Clock" size={14} />
              </div>
              <div>
                <p className="text-[9px] text-gray-400 font-bold">ご希望時間</p>
                <p className="text-xs font-mono font-black text-[#E53E3E]">{selectedSlot.startTime}~{selectedSlot.endTime}</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleInfoSubmit} className="space-y-4">
            {/* 入力ブロック */}
            <div className="bg-white p-5 rounded-[2rem] border-4 border-[#FED7D7] space-y-4 shadow-sm">
              <h4 className="text-xs font-black text-[#E53E3E] flex items-center gap-1.5 border-b border-dashed border-[#FED7D7] pb-2">
                <span>👤</span> 代表者さまの情報
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-gray-600 mb-1">
                    お名前（漢字・ひらがななど） <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="例：山田 花子"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    maxLength={20}
                    className="w-full px-4 py-2.5 border-4 border-gray-100 hover:border-gray-200 focus:border-[#E53E3E] focus:outline-none rounded-2xl font-black text-xs bg-gray-50/50 text-gray-800"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-600 mb-1">
                    電話番号（ハイフンなし） <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="例：09012345678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    maxLength={11}
                    className="w-full px-4 py-2.5 border-4 border-gray-100 hover:border-gray-200 focus:border-[#E53E3E] focus:outline-none rounded-2xl font-black text-xs bg-gray-50/50 text-gray-800"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-600 mb-1">
                  関係性 <span className="text-red-500">*</span>
                </label>
                <select
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  className="w-full px-4 py-2.5 border-4 border-gray-100 hover:border-gray-200 focus:border-[#E53E3E] focus:outline-none rounded-2xl font-black text-xs bg-gray-50/50 text-gray-800"
                >
                  <option value="一般">一般</option>
                  <option value="学生">学生</option>
                  <option value="学生保護者">学生保護者</option>
                </select>
              </div>
            </div>

            {/* 人数選択 */}
            <div className="bg-amber-50/30 p-5 rounded-[2rem] border-4 border-amber-100 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <label className="text-xs font-black text-gray-700 flex items-center gap-1">
                  <span>👥</span> ふれあう人数（代表者を含む）<span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-1 bg-white p-1 rounded-2xl border-2 border-gray-100 self-start sm:self-auto">
                  {[1, 2, 3, 4].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handlePartySizeChange(num)}
                      className={`px-3.5 py-1 rounded-xl text-xs font-black transition-all cursor-pointer ${
                        partySize === num
                          ? "bg-[#E53E3E] text-white shadow-sm"
                          : "text-gray-500 hover:bg-gray-100"
                      }`}
                    >
                      {num}人
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-gray-400 font-bold leading-relaxed">
                ※ 2名以上でのご体験の場合は、混雑防止・スムーズなご案内のため、同行されるお友達・ご家族の情報も追加で登録をお願いしております。
              </p>
            </div>

            {/* 同行者入力フォーム */}
            {partySize > 1 && (
              <div className="bg-[#EBF8FF]/50 p-5 rounded-[2rem] border-4 border-blue-100 space-y-4 animate-scale-in">
                <h4 className="text-xs font-black text-blue-600 flex items-center gap-1.5 border-b border-dashed border-blue-200 pb-2">
                  <span>🐾</span> 同行者さまの情報
                </h4>

                {companions.map((comp, idx) => (
                  <div key={idx} className="p-4 bg-white rounded-2xl border border-blue-100 space-y-3">
                    <span className="text-[9px] bg-blue-50 text-blue-600 font-black px-2.5 py-0.5 rounded-full inline-block">
                      お友達・ご家族 {idx + 1}
                    </span>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-black text-gray-500 mb-1">
                          お名前（フルネーム） <span className="text-red-500">*</span>
                        </label>
                        <input 
                          type="text" 
                          placeholder={`例：山田 太郎`}
                          value={comp.name}
                          onChange={(e) => handleCompanionChange(idx, "name", e.target.value)}
                          maxLength={20}
                          required
                          className="w-full px-3 py-2 border-2 border-gray-200 focus:border-blue-400 focus:outline-none rounded-xl font-black text-xs bg-gray-50/50"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-gray-500 mb-1">
                          電話番号（連絡用） <span className="text-red-500">*</span>
                        </label>
                        <input 
                          type="tel" 
                          placeholder={`例：09098765432`}
                          value={comp.phone}
                          onChange={(e) => handleCompanionChange(idx, "phone", e.target.value)}
                          maxLength={11}
                          required
                          className="w-full px-3 py-2 border-2 border-gray-200 focus:border-blue-400 focus:outline-none rounded-xl font-black text-xs bg-gray-50/50"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {errorMsg && (
              <div className="bg-[#FFF5F5] border-2 border-[#FED7D7] text-[#E53E3E] text-xs font-black p-3 rounded-2xl flex items-start gap-1.5">
                <LucideIcon name="AlertTriangle" size={16} className="shrink-0 text-[#E53E3E] mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setCurrentStep("select_time")}
                className="flex-1 bg-white text-gray-600 font-black py-3.5 rounded-2xl text-xs transition-all border-4 border-gray-200 border-b-8 hover:bg-gray-50 active:border-b-4 active:translate-y-[2px]"
              >
                もどる
              </button>
              <button
                type="submit"
                className="flex-[2] bg-[#E53E3E] hover:bg-[#C53030] text-white font-black py-3.5 rounded-2xl text-xs border-4 border-[#9B2C2C] border-b-8 active:border-b-4 active:translate-y-[2px] shadow-sm flex items-center justify-center gap-1.5"
              >
                確認画面へ進む 🐾
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 🎟️ STEP 4: 最終確認 */}
      {currentStep === "confirm" && selectedBooth && selectedSlot && (
        <div className="space-y-4 animate-fade-in">
          <div className="text-center space-y-1">
            <span className="text-xs bg-[#FFF5F5] border-2 border-[#FED7D7] text-[#E53E3E] font-black px-3.5 py-1 rounded-full">
              STEP 4 / 4
            </span>
            <h3 className="text-lg font-black text-gray-800 mt-1.5">
              この内容で予約を確定するよ！👀
            </h3>
            <p className="text-[11px] text-gray-500 font-bold">
              内容に間違いがないか最終チェックをお願いします！
            </p>
          </div>

          {/* チケット風のプレビューデザイン */}
          <div className="bg-white rounded-[2.5rem] border-4 border-[#E53E3E] overflow-hidden shadow-lg relative">
            {/* チケット左上の可愛いマーク */}
            <div className="absolute top-4 left-4 text-xs font-black text-gray-300 pointer-events-none select-none">CONFIRMATION TICKET</div>
            
            {/* チケット側面の半円の切り取り線（スリット）のモック（可愛い装飾） */}
            <div className="absolute top-1/2 -left-3.5 w-6 h-6 bg-[#FFF5F5] border-r-4 border-r-[#E53E3E] rounded-full transform -translate-y-1/2 z-10"></div>
            <div className="absolute top-1/2 -right-3.5 w-6 h-6 bg-[#FFF5F5] border-l-4 border-l-[#E53E3E] rounded-full transform -translate-y-1/2 z-10"></div>

            <div className="p-6 bg-[#FFF5F5] border-b-4 border-dashed border-gray-200 text-center relative pt-8">
              <span className="text-5xl inline-block mb-2 bg-white p-3 rounded-3xl border border-gray-200">
                {getAnimalMeta(selectedBooth.id).emoji}
              </span>
              <h4 className="text-base font-black text-gray-800">
                {selectedBooth.name}
              </h4>
              <p className="text-[10px] text-[#E53E3E] font-black mt-1 uppercase tracking-widest bg-white inline-block px-3 py-1 rounded-full border border-[#FED7D7]">
                どうぶつふれあい整理券（仮予約確認）
              </p>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-gray-400 font-bold flex items-center gap-1">
                    <LucideIcon name="Clock" size={13} />
                    体験時間
                  </span>
                  <span className="text-sm font-mono font-black text-[#E53E3E]">
                    {selectedSlot.startTime}~{selectedSlot.endTime}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-gray-400 font-bold flex items-center gap-1">
                    <LucideIcon name="User" size={13} />
                    代表者
                  </span>
                  <span className="font-black text-gray-800">
                    {userName} 様
                  </span>
                </div>
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-gray-400 font-bold flex items-center gap-1">
                    <LucideIcon name="Phone" size={13} />
                    ご連絡先
                  </span>
                  <span className="font-mono font-bold text-gray-800">
                    {phone.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3")}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-gray-400 font-bold flex items-center gap-1">
                    <LucideIcon name="Users" size={13} />
                    体験人数
                  </span>
                  <span className="font-black text-[#E53E3E] text-sm">
                    {partySize} 名様
                  </span>
                </div>
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-gray-400 font-bold flex items-center gap-1">
                    <LucideIcon name="Tag" size={13} />
                    区分
                  </span>
                  <span className="font-bold text-gray-800">
                    {relationship}
                  </span>
                </div>
              </div>

              {/* 同行者リストがあれば表示 */}
              {companions.length > 0 && (
                <div className="bg-gray-50/80 p-3 rounded-2xl border border-gray-100 space-y-1.5">
                  <p className="text-[10px] text-gray-400 font-black">一緒にふれあうお友達・ご家族</p>
                  <ul className="space-y-1">
                    {companions.map((c, i) => (
                      <li key={i} className="text-[10px] text-gray-700 font-bold flex justify-between">
                        <span>・{c.name} 様</span>
                        <span className="font-mono text-gray-500">{c.phone.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 注意書き */}
              <div className="text-[10px] text-[#DD6B20] bg-orange-50 p-3.5 rounded-2xl border border-orange-100 flex items-start gap-1.5 font-bold leading-relaxed">
                <div className="text-[#DD6B20] mt-0.5 shrink-0">
                  <LucideIcon name="AlertCircle" size={13} />
                </div>
                <div>
                  ※ 体験開始の <span className="underline">5分前</span> には必ず各ふれあいブースへお集まりください。
                  <br />
                  ※ 無断キャンセルはお控えいただき、遅れる場合は速やかにご連絡ください。他のお客様の枠確保にご協力をお願いいたします。
                </div>
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="bg-[#FFF5F5] border-2 border-[#FED7D7] text-[#E53E3E] text-xs font-black p-3 rounded-2xl flex items-start gap-1.5">
              <LucideIcon name="AlertTriangle" size={16} className="shrink-0 text-[#E53E3E] mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={() => setCurrentStep("input_info")}
              disabled={isSubmitting}
              className="flex-1 bg-white text-gray-600 font-black py-3.5 rounded-2xl text-xs transition-all border-4 border-gray-200 border-b-8 hover:bg-gray-50 active:border-b-4 active:translate-y-[2px] disabled:opacity-50"
            >
              修正する ✏️
            </button>
            <button
              type="button"
              onClick={handleConfirmBooking}
              disabled={isSubmitting}
              className="flex-[2] bg-[#E53E3E] hover:bg-[#C53030] text-white font-black py-3.5 rounded-2xl text-xs border-4 border-[#9B2C2C] border-b-8 active:border-b-4 active:translate-y-[2px] shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <LucideIcon name="RefreshCw" size={14} className="animate-spin" />
                  予約を確定中...🐾
                </>
              ) : (
                <>
                  <LucideIcon name="Check" size={14} />
                  上記内容で予約を確定する！🎟️
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 🎉 STEP 5: 予約完了画面（完了＆スクショ推奨） */}
      {currentStep === "completed" && createdReservation && completedBoothInfo && completedSlotInfo && (
        <div className="space-y-6 animate-scale-in">
          <div className="text-center space-y-2">
            <div className="inline-block bg-emerald-100 text-emerald-800 border-2 border-emerald-200 text-xs font-black px-4 py-1.5 rounded-full animate-bounce">
              🎉 予約が完了しました！
            </div>
            <h3 className="text-xl font-black text-gray-800 mt-1.5">
              整理券が発券されました！🎟️
            </h3>
            <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-3 max-w-sm mx-auto flex items-center justify-center gap-2">
              <span className="text-xl">📸</span>
              <p className="text-xs text-amber-800 font-black leading-tight">
                電波が不安定な場所に備えて、<br />
                <span className="text-sm text-red-600 underline">この画面のスクリーンショット</span>を推奨します！
              </p>
            </div>
          </div>

          {/* 確定チケット風デザイン */}
          <div className="bg-white rounded-[2.5rem] border-4 border-emerald-500 overflow-hidden shadow-xl relative animate-fade-in">
            <div className="absolute top-4 left-4 text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md pointer-events-none select-none">
              OFFICIAL RESERVATION TICKET
            </div>
            
            {/* チケット側面の半円の切り取り線 */}
            <div className="absolute top-1/2 -left-3.5 w-6 h-6 bg-[#FFF5F5] border-r-4 border-r-emerald-500 rounded-full transform -translate-y-1/2 z-10"></div>
            <div className="absolute top-1/2 -right-3.5 w-6 h-6 bg-[#FFF5F5] border-l-4 border-l-emerald-500 rounded-full transform -translate-y-1/2 z-10"></div>

            <div className="p-6 bg-emerald-50/50 border-b-4 border-dashed border-gray-200 text-center relative pt-8">
              <span className="text-5xl inline-block mb-2 bg-white p-3 rounded-3xl border border-emerald-100 shadow-inner">
                {getAnimalMeta(completedBoothInfo.id).emoji}
              </span>
              <h4 className="text-base font-black text-gray-800">
                {completedBoothInfo.name}
              </h4>
              
              {/* 整理券番号を大きく */}
              <div className="mt-3 inline-block bg-white border-4 border-emerald-500 rounded-2xl px-6 py-2.5 shadow-md">
                <p className="text-[10px] text-gray-400 font-bold tracking-wider">整理券番号</p>
                <p className="text-2xl font-mono font-black text-emerald-600 tracking-wider">
                  {createdReservation.ticketNumber}
                </p>
              </div>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-gray-400 font-bold flex items-center gap-1">
                    <LucideIcon name="Clock" size={13} />
                    体験時間
                  </span>
                  <span className="text-sm font-mono font-black text-emerald-600 bg-emerald-50 px-3 py-0.5 rounded-full">
                    {completedSlotInfo.startTime}~{completedSlotInfo.endTime}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-gray-400 font-bold flex items-center gap-1">
                    <LucideIcon name="User" size={13} />
                    代表者
                  </span>
                  <span className="font-black text-gray-800">
                    {userName} 様
                  </span>
                </div>
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-gray-400 font-bold flex items-center gap-1">
                    <LucideIcon name="Phone" size={13} />
                    ご連絡先
                  </span>
                  <span className="font-mono font-bold text-gray-800">
                    {phone.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3")}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-gray-400 font-bold flex items-center gap-1">
                    <LucideIcon name="Users" size={13} />
                    体験人数
                  </span>
                  <span className="font-black text-emerald-600 text-sm">
                    {partySize} 名様
                  </span>
                </div>
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-gray-400 font-bold flex items-center gap-1">
                    <LucideIcon name="Tag" size={13} />
                    区分
                  </span>
                  <span className="font-bold text-gray-800">
                    {relationship}
                  </span>
                </div>
              </div>

              {/* 同行者リストがあれば表示 */}
              {companions.length > 0 && (
                <div className="bg-gray-50/80 p-3 rounded-2xl border border-gray-100 space-y-1.5">
                  <p className="text-[10px] text-gray-400 font-black">一緒にふれあうお友達・ご家族</p>
                  <ul className="space-y-1">
                    {companions.map((c, i) => (
                      <li key={i} className="text-[10px] text-gray-700 font-bold flex justify-between">
                        <span>・{c.name} 様</span>
                        <span className="font-mono text-gray-500">{c.phone.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 注意書き */}
              <div className="text-[10px] text-emerald-800 bg-emerald-50 p-3.5 rounded-2xl border border-emerald-100 flex items-start gap-1.5 font-bold leading-relaxed">
                <div className="text-emerald-600 mt-0.5 shrink-0">
                  <LucideIcon name="AlertCircle" size={13} />
                </div>
                <div>
                  ※ 体験開始の <span className="underline">5分前</span> には必ず各ふれあいブースへお集まりください。
                  <br />
                  ※ この整理券（スクリーンショット）をスタッフへご提示ください。
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setSelectedBoothId("");
                setSelectedSlotId("");
                setUserName("");
                setPhone("");
                setRelationship("一般");
                setPartySize(1);
                setCompanions([]);
                setErrorMsg("");
                setCreatedReservation(null);
                setCompletedBoothInfo(null);
                setCompletedSlotInfo(null);
                setCurrentStep("intro");
              }}
              className="flex-1 bg-white text-gray-600 font-black py-4 rounded-2xl text-xs transition-all border-4 border-gray-200 border-b-8 hover:bg-[#FAF5FF] active:border-b-4 active:translate-y-[2px]"
            >
              🔄 別の予約をとる
            </button>
            <button
              type="button"
              onClick={() => {
                if (createdReservation) {
                  onSuccess(createdReservation);
                }
              }}
              className="flex-[2] bg-emerald-500 hover:bg-emerald-600 text-white font-black py-4 rounded-2xl text-xs border-4 border-emerald-700 border-b-8 active:border-b-4 active:translate-y-[2px] shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
            >
              🎟️ マイチケット一覧へ進む
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
