import React, { useState, useEffect } from "react";
import { 
  collection, 
  onSnapshot, 
  doc, 
  getDoc,
  query,
  where
} from "firebase/firestore";
import { db, initializeDatabase } from "./firebase";
import { AnimalBooth, TimeSlot, Reservation, SystemSettings } from "./types";
import { getOrCreateDeviceToken } from "./utils";

// 各コンポーネント
import Header from "./components/Header";
import AdminPanel from "./components/AdminPanel";
import BoothCard from "./components/BoothCard";
import SlotSelector from "./components/SlotSelector";
import BookingModal from "./components/BookingModal";
import TicketDetail from "./components/TicketDetail";
import ReservationStatusDashboard from "./components/ReservationStatusDashboard";
import LucideIcon from "./components/LucideIcon";
import StepBookingFlow from "./components/StepBookingFlow";

export default function App() {
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [deviceToken] = useState(() => getOrCreateDeviceToken());
  
  // GAS API URL の状態
  const [gasApiUrl, setGasApiUrl] = useState(() => localStorage.getItem("animal_fes_gas_api_url") || "");

  // 各データ状態
  const [booths, setBooths] = useState<AnimalBooth[]>([]);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  
  // 選択系状態
  const [selectedBoothId, setSelectedBoothId] = useState<string>("");
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [myReservations, setMyReservations] = useState<Reservation[]>([]);
  const [activeTicketIndex, setActiveTicketIndex] = useState(0);
  const [isAddingBooking, setIsAddingBooking] = useState(true);
  
  // テスト用の模擬時間 (デフォルトは現在の時分)
  const [simulatedTime, setSimulatedTime] = useState(() => {
    const now = new Date();
    // 営業時間外（11時前または14時以降）の場合は、テストしやすいようにデフォルト 11:15 に設定（予約枠11:00〜14:00に合わせる）
    const currentHour = now.getHours();
    if (currentHour < 11 || currentHour >= 14) {
      return { hour: 11, minute: 15 };
    }
    return { hour: currentHour, minute: now.getMinutes() };
  });

  const [isLoading, setIsLoading] = useState(true);

  // GASからのデータ取得処理
  const fetchAppDataFromGas = async (url: string) => {
    try {
      const response = await fetch(`${url}?action=getData`);
      const data = await response.json();
      if (data && !data.error) {
        setSystemSettings(data.systemSettings);
        setBooths(data.booths);
        setSlots(data.slots);
        
        // ローカルストレージ内の自分の予約とGAS側の全予約データを同期
        const localListJson = localStorage.getItem("animal_fes_reservations");
        if (localListJson) {
          try {
            const localList = JSON.parse(localListJson) as Reservation[];
            const updatedList = localList.map(localRes => {
              const serverRes = data.reservations.find((r: any) => r.id === localRes.id);
              if (serverRes) {
                return {
                  ...localRes,
                  status: serverRes.status,
                  userName: serverRes.userName,
                  phone: serverRes.phone,
                  relationship: serverRes.relationship
                };
              }
              return localRes;
            }).filter(r => r.status !== 'cancelled'); // キャンセル済みは除外
            
            setMyReservations(updatedList);
            localStorage.setItem("animal_fes_reservations", JSON.stringify(updatedList));
          } catch (e) {
            console.error("Local reservation parse error:", e);
          }
        }

        // デフォルト選択
        if (data.booths && data.booths.length > 0 && !selectedBoothId) {
          setSelectedBoothId(data.booths[0].id);
        }
      }
    } catch (err) {
      console.error("GASからのデータ同期に失敗しました:", err);
    }
  };

  // 1. データベースの自動初期化＆各リアルタイム購読 / GASポーリング
  useEffect(() => {
    if (gasApiUrl) {
      // --- 📊 Googleスプレッドシート(GAS) モード ---
      setIsLoading(true);
      fetchAppDataFromGas(gasApiUrl).then(() => setIsLoading(false));

      // 10秒に1回バックグラウンド自動同期
      const interval = setInterval(() => {
        fetchAppDataFromGas(gasApiUrl);
      }, 10000);

      return () => clearInterval(interval);
    }

    // --- 🔥 従来の Firebase (Firestore) モード ---
    let unsubSettings: (() => void) | null = null;
    let unsubBooths: (() => void) | null = null;
    let unsubSlots: (() => void) | null = null;

    async function setupAndSubscribe() {
      try {
        // データベースの初期確認（空なら初期データを自動投入）
        await initializeDatabase();
      } catch (err) {
        console.error("Database check failed: ", err);
      }

      try {
        // システム設定のリアルタイム購読
        unsubSettings = onSnapshot(doc(db, "system", "settings"), (docSnap) => {
          if (docSnap.exists()) {
            setSystemSettings(docSnap.data() as SystemSettings);
          }
        });

        // 体験ブースのリアルタイム購読
        unsubBooths = onSnapshot(collection(db, "booths"), (snapshot) => {
          const boothList: AnimalBooth[] = [];
          snapshot.forEach((docSnap) => {
            boothList.push(docSnap.data() as AnimalBooth);
          });
          setBooths(boothList);
          // デフォルトで最初のブースを選択
          if (boothList.length > 0 && !selectedBoothId) {
            setSelectedBoothId(boothList[0].id);
          }
        });

        // 時間枠スロットのリアルタイム購読
        unsubSlots = onSnapshot(collection(db, "slots"), (snapshot) => {
          const slotList: TimeSlot[] = [];
          snapshot.forEach((docSnap) => {
            slotList.push(docSnap.data() as TimeSlot);
          });
          setSlots(slotList);
        });
      } catch (err) {
        console.error("Subscription failed: ", err);
      } finally {
        setIsLoading(false);
      }
    }

    setupAndSubscribe();

    return () => {
      if (unsubSettings) unsubSettings();
      if (unsubBooths) unsubBooths();
      if (unsubSlots) unsubSlots();
    };
  }, [gasApiUrl]);

  // 2. LocalStorageから自分の複数の予約チケットを復元する
  useEffect(() => {
    // 古い単一キーからのデータ移行
    const oldResJson = localStorage.getItem("animal_fes_my_reservation");
    let initialList: Reservation[] = [];
    
    if (oldResJson) {
      try {
        const singleRes = JSON.parse(oldResJson) as Reservation;
        if (singleRes && singleRes.id) {
          initialList.push(singleRes);
        }
        localStorage.removeItem("animal_fes_my_reservation");
      } catch (e) {
        console.error(e);
      }
    }

    const localListJson = localStorage.getItem("animal_fes_reservations");
    if (localListJson) {
      try {
        const list = JSON.parse(localListJson) as Reservation[];
        if (Array.isArray(list)) {
          initialList = [...initialList, ...list];
        }
      } catch (e) {
        console.error(e);
      }
    }

    // 重複をIDで排除
    const uniqueMap = new Map<string, Reservation>();
    initialList.forEach(item => {
      if (item && item.id) {
        uniqueMap.set(item.id, item);
      }
    });
    const uniqueList = Array.from(uniqueMap.values());

    if (uniqueList.length > 0) {
      const verifyAllReservations = async () => {
        const verifiedList: Reservation[] = [];
        for (const res of uniqueList) {
          try {
            const resRef = doc(db, "reservations", res.id);
            const resSnap = await getDoc(resRef);
            if (resSnap.exists()) {
              const dbData = resSnap.data() as Reservation;
              if (dbData.status !== 'cancelled') {
                verifiedList.push({
                  ...res,
                  status: dbData.status,
                  userName: dbData.userName,
                  phone: dbData.phone,
                  relationship: dbData.relationship
                });
              }
            }
          } catch (err) {
            console.error("Verify reservation error:", err);
            verifiedList.push(res);
          }
        }
        localStorage.setItem("animal_fes_reservations", JSON.stringify(verifiedList));
        setMyReservations(verifiedList);
      };
      
      verifyAllReservations();
    }
  }, []);

  // 新規予約に成功した際のコールバック
  const handleBookingSuccess = (newRes: Reservation) => {
    setMyReservations(prev => {
      const updated = [...prev, newRes];
      localStorage.setItem("animal_fes_reservations", JSON.stringify(updated));
      // 最新のチケットにフォーカス
      setActiveTicketIndex(updated.length - 1);
      return updated;
    });
    setIsAddingBooking(false); // 予約追加モードを終了
    setSelectedSlot(null); // モーダルを閉じる
  };

  // チケットキャンセル成功時のコールバック
  const handleCancelSuccess = (reservationId: string) => {
    setMyReservations(prev => {
      const updated = prev.filter(r => r.id !== reservationId);
      localStorage.setItem("animal_fes_reservations", JSON.stringify(updated));
      // フォーカス位置の調整
      setActiveTicketIndex(Math.max(0, updated.length - 1));
      return updated;
    });
  };

  // グループ用連続予約のハンドラ (チケット画面からスロットを引き継いで予約)
  const handleBookAnother = (slot: TimeSlot) => {
    const booth = booths.find(b => b.id === slot.animalId);
    if (booth) {
      setSelectedBoothId(booth.id);
      setSelectedSlot(slot);
      setIsAddingBooking(true);
    }
  };

  const selectedBooth = booths.find((b) => b.id === selectedBoothId);

  return (
    <div className="min-h-screen flex flex-col bg-[#FFF5F5] text-gray-800 pb-16 font-sans">
      {/* 可愛いヘッダー */}
      <Header 
        onAdminClick={() => setIsAdminMode(!isAdminMode)} 
        isAdminMode={isAdminMode} 
        onHomeClick={() => {
          setIsAdminMode(false);
          setIsAddingBooking(true);
        }}
      />

      {/* メインコンテンツエリア */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">

        {!isLoading && !isAdminMode && myReservations.length > 0 && (
          <div className="mb-6 flex justify-center">
            <div className="bg-white rounded-2xl p-1 border-4 border-[#FED7D7] shadow-sm flex space-x-1 w-full max-w-md">
              <button
                onClick={() => setIsAddingBooking(true)}
                className={`flex-1 py-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  isAddingBooking 
                    ? "bg-[#E53E3E] text-white shadow-md" 
                    : "bg-white hover:bg-gray-50 text-gray-700"
                }`}
              >
                <LucideIcon name="Home" size={14} />
                予約ホーム (体験追加) 🏠
              </button>
              <button
                onClick={() => setIsAddingBooking(false)}
                className={`flex-1 py-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer relative ${
                  !isAddingBooking 
                    ? "bg-[#E53E3E] text-white shadow-md" 
                    : "bg-white hover:bg-gray-50 text-gray-700"
                }`}
              >
                <LucideIcon name="Ticket" size={14} />
                マイチケット ({myReservations.length}) 🎟️
                <span className="absolute -top-1 -right-1 bg-amber-400 text-rose-950 font-black text-[9px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-sm animate-bounce">
                  {myReservations.length}
                </span>
              </button>
            </div>
          </div>
        )}
        
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-[#FED7D7] border-t-[#E53E3E] rounded-full animate-spin"></div>
              <span className="absolute inset-0 flex items-center justify-center text-xs">🐾</span>
            </div>
            <p className="text-sm font-black text-[#E53E3E] animate-pulse">
              どうぶつたちをよんでいます...
            </p>
          </div>
        ) : isAdminMode ? (
          // 🔒 管理者ダッシュボード
          <AdminPanel 
            systemSettings={systemSettings}
            booths={booths}
            slots={slots}
            simulatedTime={simulatedTime}
            setSimulatedTime={setSimulatedTime}
            gasApiUrl={gasApiUrl}
            setGasApiUrl={setGasApiUrl}
            onRefreshData={gasApiUrl ? () => fetchAppDataFromGas(gasApiUrl) : undefined}
          />
        ) : (myReservations.length > 0 && !isAddingBooking) ? (
          // 🎟️ 取得したチケットの表示（すでに予約済みの場合はこれだけを見せることで「まとめ取り」を完全防止！）
          <div className="space-y-6 animate-scale-in">
            <div className="text-center py-4 bg-[#E6FFFA] border-4 border-[#B2F5EA] rounded-3xl max-w-md mx-auto p-4 shadow-sm">
              <p className="text-xs text-[#319795] font-black flex items-center justify-center gap-1.5">
                <LucideIcon name="CheckCircle" size={15} className="text-[#319795]" />
                整理券が確保されています！
              </p>
              <p className="text-[10px] text-[#319795] font-bold mt-1 leading-relaxed">
                こちらの画面が当日の【ふれあい体験 引換券】となります。🐾
                <br />
                スマホの画面を現地で見せるか、スクリーンショットで保存してスタッフにご提示ください！
              </p>
            </div>

            {/* チケットの切り替えタブ */}
            {myReservations.length > 1 && (
              <div className="max-w-md mx-auto bg-white rounded-2xl p-2 border-2 border-[#FED7D7] flex flex-wrap gap-1.5 justify-center shadow-sm">
                {myReservations.map((res, idx) => {
                  const isActive = activeTicketIndex === idx;
                  const booth = booths.find(b => b.id === res.animalId);
                  return (
                    <button
                      key={res.id}
                      onClick={() => setActiveTicketIndex(idx)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                        isActive 
                          ? "bg-[#E53E3E] text-white shadow-sm border border-[#E53E3E]" 
                          : "bg-[#FFF5F5] hover:bg-[#FED7D7] text-gray-700 border border-transparent"
                      }`}
                    >
                      {idx + 1}. {res.userName} 様 ({booth ? booth.name.split(" ")[0] : "体験"})
                    </button>
                  );
                })}
              </div>
            )}

            {(() => {
              const safeIdx = Math.min(activeTicketIndex, myReservations.length - 1);
              const activeRes = myReservations[safeIdx];
              if (!activeRes) return null;
              
              const b = booths.find(x => x.id === activeRes.animalId) || {
                id: activeRes.animalId,
                name: activeRes.animalId === "dog1" ? "犬1 🐾" :
                      activeRes.animalId === "dog2" ? "犬2 🐕" :
                      activeRes.animalId === "dog3" ? "犬3 🐩" :
                      activeRes.animalId === "cat" ? "ねこ 🐱" :
                      activeRes.animalId === "small_animal" ? "小動物 🐹" : "どうぶつふれあい体験",
                description: "かわいいどうぶつたちと触れ合おう！",
                icon: (activeRes.animalId === "dog1" || activeRes.animalId === "dog2" || activeRes.animalId === "dog3") ? "Dog" :
                      activeRes.animalId === "cat" ? "Cat" :
                      activeRes.animalId === "small_animal" ? "Rabbit" : "Heart",
                color: "bg-[#FFF5F5]"
              };

              const defaultTimes = [
                { start: "11:00", end: "11:30" },
                { start: "11:30", end: "12:00" },
                { start: "12:00", end: "12:30" },
                { start: "12:30", end: "13:00" },
                { start: "13:00", end: "13:30" },
                { start: "13:30", end: "14:00" }
              ];
              let s = slots.find(x => x.id === activeRes.slotId);
              if (!s) {
                const match = activeRes.slotId.match(/_slot_(\d+)/);
                const idx = match ? parseInt(match[1], 10) : 0;
                const time = defaultTimes[idx] || defaultTimes[0];
                s = {
                  id: activeRes.slotId,
                  animalId: activeRes.animalId,
                  startTime: time.start,
                  endTime: time.end,
                  capacity: 5,
                  bookedCount: 0
                };
              }

              return (
                <div className="space-y-4">
                  <TicketDetail 
                    reservation={activeRes}
                    booth={b}
                    slot={s}
                    onCancelSuccess={handleCancelSuccess}
                    onBookAnother={handleBookAnother}
                    simulatedTime={simulatedTime}
                  />

                  {/* 他のブースや同行者のための追加予約動線 */}
                  <div className="max-w-md mx-auto text-center pt-2 space-y-3">
                    <button
                      type="button"
                      onClick={() => {
                        // 同じスロットでなくても、他の予約をとるための「追加予約モード」をオンにする
                        setIsAddingBooking(true);
                      }}
                      className="w-full bg-white hover:bg-[#FFF5F5] text-[#E53E3E] border-4 border-[#E53E3E] px-6 py-3.5 rounded-[1.5rem] text-sm font-black shadow-[4px_4px_0px_#E53E3E] hover:shadow-[2px_2px_0px_#E53E3E] active:translate-y-0.5 transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <LucideIcon name="UserPlus" size={16} />
                      お友達の分や、別のどうぶつ体験を追加予約する ➕
                    </button>
                    <p className="text-[10px] text-gray-400 font-bold leading-relaxed">
                      ※ 予約上限防止のため、別のメンバーのお名前と電話番号を入力してください。
                      <br />
                      ※ すでにご予約した時間帯と同じスロットの追加予約も可能です。
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          // 🙋 一般来場者予約フロー (または予約追加中モード)
          <div className="space-y-6 animate-fade-in">
            {isAddingBooking && myReservations.length > 0 && (
              <div className="max-w-md mx-auto">
                <button
                  type="button"
                  onClick={() => setIsAddingBooking(false)}
                  className="bg-white hover:bg-gray-100 text-gray-700 px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer border-2 border-gray-300 shadow-sm"
                >
                  <LucideIcon name="ArrowLeft" size={14} />
                  自分の確保した整理券（引換券）に戻る
                </button>
              </div>
            )}
            
            {/* ウェルカムバナー */}
            <div className="bg-white rounded-[2rem] p-6 shadow-md border-4 border-[#FED7D7] flex flex-col md:flex-row items-center gap-5 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-[#E53E3E]/5 rounded-full -mr-10 -mt-10"></div>
              
              <div className="bg-[#E53E3E] text-white p-4.5 rounded-2xl shrink-0 flex items-center justify-center shadow-md border-2 border-white">
                <LucideIcon name="Heart" size={32} className="fill-white" />
              </div>
              
              <div className="space-y-1.5 text-center md:text-left">
                <h2 className="text-base font-black text-[#E53E3E] flex items-center justify-center md:justify-start gap-1">
                  🐾 どうぶつ専門学校へようこそ！
                </h2>
                <p className="text-xs text-gray-500 leading-relaxed font-bold">
                  本日限定の「どうぶつふれあい体験」は混雑緩和のため、便利な<span className="font-black text-[#E53E3E] underline">オンライン整理券</span>を導入しています。
                  お好きなブースと体験時間を選び、お名前を入力するだけで1名様分のチケットがリアルタイムで取れます！
                </p>
              </div>
            </div>

            {/* システム受付状況の表示 */}
            {systemSettings && !systemSettings.isBookingOpen && (
              <div className="bg-[#FFF5F5] border-4 border-[#FED7D7] rounded-[2rem] p-5 flex items-start gap-3 text-sm">
                <div className="text-[#E53E3E] shrink-0 mt-0.5 animate-bounce">
                  <LucideIcon name="Lock" size={20} />
                </div>
                <div>
                  <h4 className="font-black text-[#E53E3E]">
                    ⚠️ 只今、整理券のオンライン受付を一時休止しています
                  </h4>
                  <p className="text-xs text-gray-500 font-bold mt-1.5">
                    どうぶつたちの体調管理や現地混雑調整のため、ただいま新規の予約受付を一時ストップしています。
                    スタッフのアナウンスや、時間を置いてからもう一度ご確認ください。
                  </p>
                </div>
              </div>
            )}



            {/* 🐾 ステップバイステップ予約フロー */}
            <div className="bg-white rounded-[2rem] p-6 shadow-md border-4 border-[#FED7D7] space-y-6">
              <StepBookingFlow
                booths={booths}
                slots={slots}
                systemSettings={systemSettings}
                deviceToken={deviceToken}
                simulatedTime={simulatedTime}
                gasApiUrl={gasApiUrl}
                onSuccess={handleBookingSuccess}
              />
            </div>
          </div>
        )}
      </main>

      {/* スマホナビゲーション/フッター風（デモ用時間表示） */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t-4 border-[#FED7D7] py-3.5 px-5 flex items-center justify-between text-[11px] font-black text-gray-400 z-40 max-w-4xl mx-auto rounded-t-[2rem] shadow-lg">
        <div className="flex items-center space-x-1">
          <span className="w-2 h-2 rounded-full bg-[#319795] inline-block animate-ping"></span>
          <span className="text-gray-500 font-black">システム：正常稼働中</span>
        </div>
        <div className="flex items-center space-x-2 text-gray-600 font-bold">
          <span>模擬時間: {simulatedTime.hour.toString().padStart(2, "0")}:{simulatedTime.minute.toString().padStart(2, "0")}</span>
          <span className="text-[#FED7D7]">|</span>
          <span>グループ・複数予約対応 🐾</span>
        </div>
      </footer>
    </div>
  );
}
