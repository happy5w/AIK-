import React, { useState, useEffect } from "react";
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  setDoc,
  updateDoc, 
  runTransaction,
  serverTimestamp,
  orderBy
} from "firebase/firestore";
import { db, initializeDatabase } from "../firebase";
import { AnimalBooth, TimeSlot, Reservation, SystemSettings, Companion } from "../types";
import LucideIcon from "./LucideIcon";
import { generateTicketNumber } from "../utils";

// GAS code stubs as the gas directory is removed to keep the bundle light
const codeJsText = `// Google Apps Script (GAS) 連動用 Code.js\n// ※このアプリは Firebase Firestore を標準データベースとしています。\n// スプレッドシート連動を行う場合は、GAS側にウェブアプリとしてデプロイを行ってください。`;
const indexHtmlText = `// Google Apps Script (GAS) 連動用 Index.html\n// Webアプリ側の表示用のHTMLサービスコードです。`;

interface AdminPanelProps {
  systemSettings: SystemSettings | null;
  booths: AnimalBooth[];
  slots: TimeSlot[];
  simulatedTime: { hour: number; minute: number };
  setSimulatedTime: React.Dispatch<React.SetStateAction<{ hour: number; minute: number }>>;
  gasApiUrl: string;
  setGasApiUrl: (url: string) => void;
  onRefreshData?: () => void;
}

export default function AdminPanel({
  systemSettings,
  booths,
  slots,
  simulatedTime,
  setSimulatedTime,
  gasApiUrl,
  setGasApiUrl,
  onRefreshData
}: AdminPanelProps) {
  const [passcode, setPasscode] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState<"reservations" | "cancelled" | "master" | "gas">("reservations");
  const [selectedBoothFilter, setSelectedBoothFilter] = useState<string>("all");
  const [selectedSlotFilter, setSelectedSlotFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  // GAS設定用の状態
  const [gasUrlInput, setGasUrlInput] = useState(gasApiUrl);
  const [isSavingGasUrl, setIsSavingGasUrl] = useState(false);
  const [copiedType, setCopiedType] = useState<"code" | "html" | null>(null);

  // GAS Web App URL の保存・検証
  const handleSaveGasUrl = async () => {
    if (!gasUrlInput.trim()) {
      alert("GASウェブアプリURLを入力してください。");
      return;
    }
    if (!gasUrlInput.startsWith("https://script.google.com/")) {
      alert("正しいGoogle Apps ScriptのウェブアプリURL（https://script.google.com/...）を入力してください。");
      return;
    }

    setIsSavingGasUrl(true);
    try {
      // 実際に疎通テスト（アクション: getData）を行う
      const testUrl = `${gasUrlInput.trim()}?action=getData`;
      const response = await fetch(testUrl);
      const data = await response.json();
      
      if (data && !data.error) {
        localStorage.setItem("animal_fes_gas_api_url", gasUrlInput.trim());
        setGasApiUrl(gasUrlInput.trim());
        alert("📊 Googleスプレッドシート(GAS)データベースと接続が完了しました！\n本アプリはこれより『スプレッドシート同期モード』で動作します。🐾");
      } else {
        throw new Error(data.error || "データ構造が不適切です。");
      }
    } catch (err: any) {
      console.error("GAS接続テストエラー:", err);
      if (window.confirm("接続確認（action=getData）に失敗しました。URLが間違っているか、GAS側のWeb Appデプロイで「アクセスできるユーザー」を「全員」にしていない可能性があります。\n\nこのまま強制的に登録しますか？")) {
        localStorage.setItem("animal_fes_gas_api_url", gasUrlInput.trim());
        setGasApiUrl(gasUrlInput.trim());
      }
    } finally {
      setIsSavingGasUrl(false);
    }
  };

  // GAS Web App URL の解除
  const handleDisconnectGasUrl = () => {
    if (window.confirm("Googleスプレッドシート（GAS）との接続を解除し、従来の Firebase Firestore モードに戻しますか？")) {
      localStorage.removeItem("animal_fes_gas_api_url");
      setGasApiUrl("");
      setGasUrlInput("");
      alert("Firebase Firestore モードに復帰しました。🐾");
    }
  };
  
  // 代理予約用フォーム状態
  const [isProxyModalOpen, setIsProxyModalOpen] = useState(false);
  const [proxyName, setProxyName] = useState("");
  const [proxyPhone, setProxyPhone] = useState("");
  const [proxyRelationship, setProxyRelationship] = useState("一般");
  const [proxySlotId, setProxySlotId] = useState("");
  const [proxyPartySize, setProxyPartySize] = useState(1);
  const [proxyCompanions, setProxyCompanions] = useState<Companion[]>([]);
  const [proxyError, setProxyError] = useState("");
  const [proxySuccess, setProxySuccess] = useState("");

  // マスタ設定フォーム状態
  const [newBoothId, setNewBoothId] = useState("");
  const [newBoothName, setNewBoothName] = useState("");
  const [newBoothDesc, setNewBoothDesc] = useState("");
  const [newBoothIcon, setNewBoothIcon] = useState("Dog");
  const [newBoothColor, setNewBoothColor] = useState("bg-red-500");

  const [newSlotBoothId, setNewSlotBoothId] = useState("");
  const [newSlotStart, setNewSlotStart] = useState("11:00");
  const [newSlotEnd, setNewSlotEnd] = useState("11:30");
  const [newSlotCapacity, setNewSlotCapacity] = useState(5);

  const [startTimeInput, setStartTimeInput] = useState("11:00");
  const [endTimeInput, setEndTimeInput] = useState("14:00");

  // スロット定員編集状態
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editingCapacityVal, setEditingCapacityVal] = useState<number>(5);

  // パスコード確認
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const correctPasscode = systemSettings?.adminPasscode || "fes123";
    if (passcode === correctPasscode || passcode === "admin") {
      setIsAuthenticated(true);
      setErrorMsg("");
    } else {
      setErrorMsg("パスコードが違います。 (学園祭デモ用：fes123)");
    }
  };

  // 予約データのリアルタイム購読 / GASポーリング
  useEffect(() => {
    if (!isAuthenticated) return;

    if (gasApiUrl) {
      // --- 📊 Googleスプレッドシート(GAS) モード ---
      const fetchGasReservations = async () => {
        try {
          const response = await fetch(`${gasApiUrl}?action=getData`);
          const data = await response.json();
          if (data && data.reservations) {
            // 文字列化されたデータ等をキャスト・整形
            const formatted = data.reservations.map((res: any) => ({
              ...res,
              partySize: Number(res.partySize),
              isAdminAdded: (res.isAdminAdded === "true" || res.isAdminAdded === true),
              createdAt: res.createdAt ? new Date(res.createdAt) : new Date(),
              companions: typeof res.companions === "string" ? JSON.parse(res.companions || "[]") : res.companions
            }));
            setReservations(formatted);
          }
        } catch (err) {
          console.error("AdminPanel GAS reservations sync error:", err);
        }
      };

      fetchGasReservations();
      const interval = setInterval(fetchGasReservations, 10000);
      return () => clearInterval(interval);
    }

    // --- 🔥 従来の Firebase (Firestore) モード ---
    const q = query(collection(db, "reservations"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const resList: Reservation[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        resList.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate() || new Date(),
        } as Reservation);
      });
      setReservations(resList);
    });

    return () => unsubscribe();
  }, [isAuthenticated, gasApiUrl]);

  // 設定時間の初期化同期
  useEffect(() => {
    if (systemSettings) {
      if (systemSettings.bookingStartTime) setStartTimeInput(systemSettings.bookingStartTime);
      if (systemSettings.bookingEndTime) setEndTimeInput(systemSettings.bookingEndTime);
    }
  }, [systemSettings]);

  // 受付消込（ステータスを Checked In に変更）
  const handleCheckIn = async (resId: string) => {
    try {
      if (gasApiUrl) {
        const response = await fetch(gasApiUrl, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ action: "checkIn", id: resId })
        });
        const res = await response.json();
        if (res.success) {
          if (onRefreshData) onRefreshData();
          setReservations(prev => prev.map(r => r.id === resId ? { ...r, status: "checked_in" } : r));
        } else {
          alert(res.error || "消込に失敗しました。");
        }
        return;
      }

      const resRef = doc(db, "reservations", resId);
      await updateDoc(resRef, { status: "checked_in" });
    } catch (err) {
      console.error("消込エラー:", err);
    }
  };

  // 予約のキャンセル処理 (ステータスをキャンセルにして枠を戻す)
  const handleCancelReservation = async (reservation: Reservation) => {
    if (!window.confirm(`${reservation.userName} 様の予約をキャンセル（枠を復活）しますか？`)) {
      return;
    }

    try {
      if (gasApiUrl) {
        const response = await fetch(gasApiUrl, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ action: "cancelReservation", id: reservation.id })
        });
        const res = await response.json();
        if (res.success) {
          if (onRefreshData) onRefreshData();
          setReservations(prev => prev.map(r => r.id === reservation.id ? { ...r, status: "cancelled" } : r));
        } else {
          alert(res.error || "キャンセルに失敗しました。");
        }
        return;
      }

      const slotRef = doc(db, "slots", reservation.slotId);
      const resRef = doc(db, "reservations", reservation.id);

      await runTransaction(db, async (transaction) => {
        const slotSnap = await transaction.get(slotRef);
        if (!slotSnap.exists()) throw new Error("時間枠が存在しません。");

        const currentBooked = slotSnap.data().bookedCount || 0;
        const pSize = reservation.partySize || 1;
        
        // 予約のステータスをキャンセル状態に更新（履歴保持）
        transaction.update(resRef, { status: "cancelled" });
        
        // 予約枠のデクリメント
        transaction.update(slotRef, {
          bookedCount: Math.max(0, currentBooked - pSize)
        });
      });
    } catch (err) {
      console.error("キャンセルエラー:", err);
      alert("キャンセルに失敗しました。");
    }
  };

  // 予約受付オープン・クローズの切り替え
  const toggleBookingOpen = async () => {
    if (!systemSettings) return;
    try {
      if (gasApiUrl) {
        const response = await fetch(gasApiUrl, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            action: "updateSettings",
            data: { isBookingOpen: !systemSettings.isBookingOpen }
          })
        });
        const res = await response.json();
        if (res.success) {
          if (onRefreshData) onRefreshData();
        } else {
          alert("設定変更に失敗しました。");
        }
        return;
      }

      const settingsRef = doc(db, "system", "settings");
      await updateDoc(settingsRef, {
        isBookingOpen: !systemSettings.isBookingOpen
      });
    } catch (err) {
      console.error("設定変更エラー:", err);
    }
  };

  // 営業時間の更新
  const handleUpdateHours = async () => {
    try {
      if (gasApiUrl) {
        const response = await fetch(gasApiUrl, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            action: "updateSettings",
            data: {
              bookingStartTime: startTimeInput,
              bookingEndTime: endTimeInput
            }
          })
        });
        const res = await response.json();
        if (res.success) {
          if (onRefreshData) onRefreshData();
          alert(`予約時間枠を「${startTimeInput} 〜 ${endTimeInput}」に設定しました！`);
        } else {
          alert("時間の更新に失敗しました。");
        }
        return;
      }

      const settingsRef = doc(db, "system", "settings");
      await updateDoc(settingsRef, {
        bookingStartTime: startTimeInput,
        bookingEndTime: endTimeInput
      });
      alert(`予約時間枠を「${startTimeInput} 〜 ${endTimeInput}」に設定しました！`);
    } catch (err) {
      console.error("営業時間設定エラー:", err);
      alert("時間の更新に失敗しました。");
    }
  };

  // データベース強制リセット（初期化）
  const handleResetDatabase = async () => {
    if (!window.confirm("【注意】予約データがすべて消去され、初期のブースと時間枠にリセットされます。実行しますか？")) {
      return;
    }
    try {
      if (gasApiUrl) {
        const response = await fetch(gasApiUrl, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ action: "resetDatabase" })
        });
        const res = await response.json();
        if (res.success) {
          if (onRefreshData) onRefreshData();
          alert("データベースを初期化リセットしました！スプレッドシートをご確認ください。");
        } else {
          alert("初期化に失敗しました。");
        }
        return;
      }

      await initializeDatabase(true);
      alert("データベースをリセットしました！");
    } catch (err) {
      alert("リセットに失敗しました。");
    }
  };

  // 代理予約における同行者数の調整
  const handleProxyPartySizeChange = (size: number) => {
    setProxyPartySize(size);
    const needed = size - 1;
    setProxyCompanions(prev => {
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

  const handleProxyCompanionChange = (index: number, field: keyof Companion, value: string) => {
    setProxyCompanions(prev => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: value
      };
      return next;
    });
  };

  // 代理予約の実行
  const handleProxyBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setProxyError("");
    setProxySuccess("");

    if (!proxyName.trim()) {
      setProxyError("代表者のお名前を入力してください。");
      return;
    }
    if (!proxyPhone.trim()) {
      setProxyError("代表者の電話番号を入力してください。");
      return;
    }
    if (!/^\d{10,11}$/.test(proxyPhone.trim())) {
      setProxyError("電話番号は10桁または11桁の数字で入力してください。");
      return;
    }
    if (!proxySlotId) {
      setProxyError("時間枠を選択してください。");
      return;
    }

    const selectedSlot = slots.find(s => s.id === proxySlotId);
    if (!selectedSlot) {
      setProxyError("選択された時間枠が見つかりません。");
      return;
    }

    // 同行者バリデーション
    const cleanedCompanions: Companion[] = [];
    for (let i = 0; i < proxyCompanions.length; i++) {
      const cName = proxyCompanions[i].name.trim();
      const cPhone = proxyCompanions[i].phone.trim().replace(/-/g, "");
      if (!cName) {
        setProxyError(`同行者 ${i + 1} のお名前を入力してください。`);
        return;
      }
      if (!cPhone) {
        setProxyError(`同行者 ${i + 1} の電話番号を入力してください。`);
        return;
      }
      if (!/^\d{10,11}$/.test(cPhone)) {
        setProxyError(`同行者 ${i + 1} の電話番号はハイフンなしの10桁または11桁の数字にしてください。`);
        return;
      }
      cleanedCompanions.push({ name: cName, phone: cPhone });
    }

    const currentBooked = selectedSlot.bookedCount || 0;
    if (currentBooked + proxyPartySize > selectedSlot.capacity) {
      setProxyError(`この枠は空き枠数を超えてしまいます（残り: ${selectedSlot.capacity - currentBooked}名分）。`);
      return;
    }

    try {
      if (gasApiUrl) {
        // --- 📊 Googleスプレッドシート連携モードでの代理予約 ---
        const response = await fetch(gasApiUrl, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            action: "createReservation",
            data: {
              slotId: proxySlotId,
              userName: proxyName.trim() + " (スタッフ代理)",
              phone: proxyPhone.trim(),
              relationship: proxyRelationship,
              partySize: proxyPartySize,
              companions: cleanedCompanions,
              deviceToken: "proxy_added",
              isAdminAdded: true
            }
          })
        });
        const res = await response.json();
        if (res.success) {
          if (onRefreshData) onRefreshData();
          setProxySuccess("代理整理券を発行しました！");
          setProxyName("");
          setProxyPhone("");
          setProxyCompanions([]);
          setProxyPartySize(1);
          setTimeout(() => {
            setIsProxyModalOpen(false);
            setProxySuccess("");
          }, 1500);
        } else {
          setProxyError(res.error || "代理予約に失敗しました。");
        }
        return;
      }

      // --- 🔥 従来の Firebase (Firestore) モードでの代理予約 ---
      const slotRef = doc(db, "slots", proxySlotId);
      
      await runTransaction(db, async (transaction) => {
        const slotSnap = await transaction.get(slotRef);
        if (!slotSnap.exists()) throw new Error("時間枠が存在しません。");
        
        const latestBookedCount = slotSnap.data().bookedCount || 0;
        if (latestBookedCount + proxyPartySize > slotSnap.data().capacity) {
          throw new Error("満員のため予約できませんでした。");
        }

        // 新しい予約ドキュメントをトランザクション内で作成
        const resRef = doc(collection(db, "reservations"));
        const ticketSeq = latestBookedCount + 1;
        const ticketNo = generateTicketNumber(selectedSlot.animalId, selectedSlot.startTime, ticketSeq);

        transaction.set(resRef, {
          id: resRef.id,
          slotId: proxySlotId,
          animalId: selectedSlot.animalId,
          userName: proxyName.trim() + " (スタッフ代理)",
          phone: proxyPhone.trim(),
          relationship: proxyRelationship,
          partySize: proxyPartySize,
          companions: cleanedCompanions,
          status: "booked", 
          ticketNumber: ticketNo,
          deviceToken: "proxy_added",
          isAdminAdded: true,
          createdAt: serverTimestamp()
        });

        transaction.update(slotRef, {
          bookedCount: latestBookedCount + proxyPartySize
        });
      });

      setProxySuccess("代理整理券を発行しました！");
      setProxyName("");
      setProxyPhone("");
      setProxyCompanions([]);
      setProxyPartySize(1);
      setTimeout(() => {
        setIsProxyModalOpen(false);
        setProxySuccess("");
      }, 1500);

    } catch (err: any) {
      setProxyError(err.message || "予約の追加に失敗しました。");
    }
  };

  // 動物ブースの追加
  const handleAddBooth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBoothId.trim() || !newBoothName.trim()) {
      alert("IDとブース名を入力してください。");
      return;
    }
    const cleanId = newBoothId.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (booths.some(b => b.id === cleanId)) {
      alert("このブースIDは既に使用されています。");
      return;
    }

    try {
      if (gasApiUrl) {
        // --- 📊 Googleスプレッドシート連携モードでのブース追加 ---
        const response = await fetch(gasApiUrl, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            action: "addBooth",
            data: {
              id: cleanId,
              name: newBoothName.trim(),
              description: newBoothDesc.trim(),
              icon: newBoothIcon,
              color: newBoothColor
            }
          })
        });
        const res = await response.json();
        if (res.success) {
          if (onRefreshData) onRefreshData();
          alert(`ブース「${newBoothName}」を追加しました！`);
          setNewBoothId("");
          setNewBoothName("");
          setNewBoothDesc("");
        } else {
          alert("ブースの追加に失敗しました。");
        }
        return;
      }

      // --- 🔥 従来の Firebase (Firestore) モードでのブース追加 ---
      const boothRef = doc(db, "booths", cleanId);
      await setDoc(boothRef, {
        id: cleanId,
        name: newBoothName.trim(),
        description: newBoothDesc.trim(),
        icon: newBoothIcon,
        color: newBoothColor
      });
      alert(`ブース「${newBoothName}」を追加しました！`);
      setNewBoothId("");
      setNewBoothName("");
      setNewBoothDesc("");
    } catch (err) {
      console.error("ブース追加エラー:", err);
      alert("ブースの追加に失敗しました。");
    }
  };

  // 時間枠の追加
  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSlotBoothId) {
      alert("ブースを選択してください。");
      return;
    }

    try {
      const slotId = `${newSlotBoothId}_slot_${Date.now()}`;

      if (gasApiUrl) {
        // --- 📊 Googleスプレッドシート連携モードでの時間枠追加 ---
        const response = await fetch(gasApiUrl, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            action: "addSlot",
            data: {
              id: slotId,
              animalId: newSlotBoothId,
              startTime: newSlotStart,
              endTime: newSlotEnd,
              capacity: Number(newSlotCapacity),
              bookedCount: 0
            }
          })
        });
        const res = await response.json();
        if (res.success) {
          if (onRefreshData) onRefreshData();
          alert(`時間帯「${newSlotStart}〜${newSlotEnd}」を追加しました！`);
        } else {
          alert("時間枠の追加に失敗しました。");
        }
        return;
      }

      // --- 🔥 従来の Firebase (Firestore) モードでの時間枠追加 ---
      const slotRef = doc(db, "slots", slotId);
      await setDoc(slotRef, {
        id: slotId,
        animalId: newSlotBoothId,
        startTime: newSlotStart,
        endTime: newSlotEnd,
        capacity: Number(newSlotCapacity),
        bookedCount: 0
      });
      alert(`時間帯「${newSlotStart}〜${newSlotEnd}」を追加しました！`);
    } catch (err) {
      console.error("時間枠追加エラー:", err);
      alert("時間枠の追加に失敗しました。");
    }
  };

  // スロットの定員変更
  const handleUpdateSlotCapacity = async (slotId: string) => {
    if (editingCapacityVal <= 0) {
      alert("定員は1名以上に設定してください。");
      return;
    }
    try {
      if (gasApiUrl) {
        // --- 📊 Googleスプレッドシート連携モードでの定員変更 ---
        const response = await fetch(gasApiUrl, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            action: "updateSlotCapacity",
            id: slotId,
            capacity: Number(editingCapacityVal)
          })
        });
        const res = await response.json();
        if (res.success) {
          if (onRefreshData) onRefreshData();
          alert("定員を変更しました！");
          setEditingSlotId(null);
        } else {
          alert("定員の変更に失敗しました。");
        }
        return;
      }

      // --- 🔥 従来の Firebase (Firestore) モードでの定員変更 ---
      const slotRef = doc(db, "slots", slotId);
      await updateDoc(slotRef, { capacity: Number(editingCapacityVal) });
      alert("定員を変更しました！");
      setEditingSlotId(null);
    } catch (err) {
      console.error("定員変更エラー:", err);
      alert("定員の変更に失敗しました。");
    }
  };

  // CSVエクスポート
  const handleExportCSV = () => {
    if (reservations.length === 0) {
      alert("エクスポートするデータがありません。");
      return;
    }

    // UTF-8 BOM to prevent excel display corruption on Japanese systems
    let csvContent = "\uFEFF";
    csvContent += "整理券番号,代表者名,電話番号,体験人数,関係性,体験ブース,時間枠,状態,予約種別,登録日時\n";

    reservations.forEach(res => {
      const booth = booths.find(b => b.id === res.animalId);
      const slot = slots.find(s => s.id === res.slotId);

      const ticketNo = res.ticketNumber || "";
      const name = res.userName || "";
      const phoneNo = res.phone || "";
      const size = res.partySize || 1;
      const relation = res.relationship || "";
      const boothName = booth ? booth.name.replace(/🐶|🐱|🐰|🐹/g, "").trim() : "不明";
      const slotTime = slot ? `${slot.startTime}-${slot.endTime}` : "不明";
      const statusStr = res.status === "checked_in" ? "受付済" : res.status === "cancelled" ? "キャンセル済" : "未受付";
      const typeStr = res.isAdminAdded ? "代理予約" : "一般予約";
      const dateStr = res.createdAt instanceof Date 
        ? res.createdAt.toLocaleString("ja-JP") 
        : new Date(res.createdAt).toLocaleString("ja-JP");

      const row = [ticketNo, name, phoneNo, size, relation, boothName, slotTime, statusStr, typeStr, dateStr]
        .map(val => `"${String(val).replace(/"/g, '""')}"`)
        .join(",");

      csvContent += row + "\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `どうぶつふれあい予約リスト_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 表示フィルタリング・検索
  const filteredReservations = reservations.filter(res => {
    // タブによるステータスフィルタ
    const isCancelledTab = activeTab === "cancelled";
    const statusMatch = isCancelledTab ? res.status === "cancelled" : res.status !== "cancelled";
    if (!statusMatch) return false;

    // ブース・スロット選択フィルタ
    const boothMatch = selectedBoothFilter === "all" || res.animalId === selectedBoothFilter;
    const slotMatch = selectedSlotFilter === "all" || res.slotId === selectedSlotFilter;
    if (!boothMatch || !slotMatch) return false;

    // 検索窓のフィルタ
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().replace(/-/g, "");
      const ticketMatch = res.ticketNumber?.toLowerCase().includes(q);
      const nameMatch = res.userName?.toLowerCase().includes(q);
      const phoneMatch = res.phone?.replace(/-/g, "").includes(q);
      
      const companionMatch = res.companions?.some(c => 
        c.name.toLowerCase().includes(q) || c.phone.replace(/-/g, "").includes(q)
      );

      return ticketMatch || nameMatch || phoneMatch || companionMatch;
    }

    return true;
  });

  const availableSlotsForProxy = slots.filter(s => {
    if (selectedBoothFilter === "all") return true;
    return s.animalId === selectedBoothFilter;
  });

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto my-12 p-8 bg-white rounded-[2.5rem] shadow-[8px_8px_0px_#2D3748] border-4 border-[#E53E3E] relative">
        <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 bg-[#E53E3E] text-white p-3.5 rounded-full border-4 border-white shadow-md">
          <LucideIcon name="Lock" size={24} />
        </div>
        <div className="text-center mt-5">
          <h2 className="text-xl font-black text-[#E53E3E]">スタッフ専用管理画面 🔒</h2>
          <p className="text-xs text-gray-500 font-bold mt-1.5">
            予約消込、マスタ編集、キャンセル確認を行うにはパスコードを入力してください。
          </p>
        </div>

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-black text-gray-600 mb-1.5">パスコード</label>
            <input 
              type="password" 
              placeholder="パスコードを入力 (デモ: fes123)"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              id="admin-passcode-input"
              className="w-full px-4 py-3 border-4 border-[#FED7D7] rounded-2xl focus:border-[#F6AD55] focus:outline-none text-center text-lg tracking-widest font-black bg-[#FFF5F5]"
            />
          </div>

          {errorMsg && (
            <p className="text-xs text-[#E53E3E] font-black bg-[#FFF5F5] border-2 border-[#FED7D7] p-2.5 rounded-xl text-center flex items-center justify-center gap-1">
              <LucideIcon name="AlertCircle" size={14} /> {errorMsg}
            </p>
          )}

          <button
            type="submit"
            id="btn-admin-login"
            className="w-full bg-[#E53E3E] hover:bg-[#C53030] text-white font-black py-3 rounded-2xl border-4 border-[#9B2C2C] border-b-8 hover:border-b-8 active:border-b-4 active:translate-y-[2px] shadow-sm text-sm tracking-wide"
          >
            管理システムへログイン 🐾
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 運営コントロールパネル */}
      <div className="bg-white rounded-[2rem] p-6 shadow-md border-4 border-[#FED7D7]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b-2 border-dashed border-[#FED7D7]">
          <div className="flex items-center space-x-2.5">
            <span className="p-2.5 bg-[#FFF5F5] text-[#E53E3E] rounded-2xl border-2 border-[#FED7D7]">
              <LucideIcon name="ShieldAlert" size={20} />
            </span>
            <div>
              <h2 className="text-lg font-black text-[#2D3748]">学園祭 運営コントロールパネル</h2>
              <p className="text-xs text-gray-500 font-bold">リアルタイムの予約管理、時間制御、マスタ更新を行います</p>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setIsProxyModalOpen(true)}
              id="btn-open-proxy-booking"
              className="bg-[#319795] hover:bg-[#287976] text-white font-black px-4 py-2 rounded-full text-xs flex items-center gap-1.5 shadow-sm border-4 border-[#234E52] border-b-8 active:border-b-4 active:translate-y-[2px] transition-all cursor-pointer"
            >
              <LucideIcon name="Users" size={14} /> スマホなし整理券代理受付 🐾
            </button>
            <button
              onClick={toggleBookingOpen}
              id="btn-toggle-booking-status"
              className={`font-black px-4 py-2 rounded-full text-xs flex items-center gap-1.5 shadow-sm border-4 transition-all border-b-8 active:border-b-4 active:translate-y-[2px] cursor-pointer ${
                systemSettings?.isBookingOpen 
                  ? "bg-[#E53E3E] hover:bg-[#C53030] text-white border-[#9B2C2C]" 
                  : "bg-gray-400 hover:bg-gray-500 text-white border-gray-600"
              }`}
            >
              <LucideIcon name={systemSettings?.isBookingOpen ? "Unlock" : "Lock"} size={14} />
              新規予約: {systemSettings?.isBookingOpen ? "受付中" : "一時停止中"}
            </button>
            <button
              onClick={handleExportCSV}
              className="bg-white hover:bg-gray-50 text-gray-700 font-black px-3.5 py-2 rounded-full text-xs flex items-center gap-1 border-4 border-gray-200 border-b-8 active:border-b-4 active:translate-y-[2px] cursor-pointer"
            >
              <LucideIcon name="Download" size={13} /> CSV出力 📊
            </button>
            <button
              onClick={handleResetDatabase}
              id="btn-reset-db"
              className="bg-white hover:bg-red-50 text-red-500 font-black px-3.5 py-2 rounded-full text-xs flex items-center gap-1 border-4 border-red-100 border-b-8 active:border-b-4 active:translate-y-[2px] cursor-pointer"
            >
              <LucideIcon name="RefreshCw" size={13} /> 初期化
            </button>
          </div>
        </div>

        {/* 当日シミュレータ＆営業時間制限 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          {/* A: シミュレーター */}
          <div className="bg-[#FFF5F5] rounded-[2rem] p-4.5 border-2 border-[#FED7D7] flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-left space-y-1">
              <h3 className="text-xs font-black text-gray-800 flex items-center gap-1">
                <span>🕒</span> 模擬時刻シミュレータ
              </h3>
              <p className="text-[10px] text-gray-500 font-bold leading-relaxed">
                学園祭時間ルール（予約開始/終了など）を検証するためにアプリ内時計を進められます。
              </p>
            </div>
            <div className="flex items-center gap-2 bg-white px-3.5 py-2 rounded-2xl shadow-inner border-2 border-[#FED7D7] shrink-0">
              <div className="text-xs font-black text-gray-800">
                時刻: <span className="text-sm font-mono text-[#E53E3E] font-black">{simulatedTime.hour.toString().padStart(2, "0")}:{simulatedTime.minute.toString().padStart(2, "0")}</span>
              </div>
              <input 
                type="range" 
                min="9" 
                max="16" 
                value={simulatedTime.hour}
                onChange={(e) => setSimulatedTime(prev => ({ ...prev, hour: Number(e.target.value) }))}
                className="w-16 accent-[#E53E3E] h-1 bg-[#FED7D7] rounded"
              />
            </div>
          </div>

          {/* B: 予約可能開始・終了時刻設定 */}
          <div className="bg-amber-50/20 rounded-[2rem] p-4.5 border-2 border-amber-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-left space-y-1">
              <h3 className="text-xs font-black text-amber-800 flex items-center gap-1">
                <span>⚙️</span> 予約可能時間枠設定
              </h3>
              <p className="text-[10px] text-gray-500 font-bold leading-relaxed">
                体験予約全体の「受付開始」と「受付終了」の営業時間。開始前・終了後メッセージが自動判定されます。
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input 
                type="text" 
                value={startTimeInput}
                onChange={(e) => setStartTimeInput(e.target.value)}
                placeholder="11:00"
                className="w-14 text-center px-2 py-1 bg-white border-2 border-amber-200 rounded-lg text-xs font-black font-mono text-gray-700"
              />
              <span className="text-xs font-black text-amber-800">〜</span>
              <input 
                type="text" 
                value={endTimeInput}
                onChange={(e) => setEndTimeInput(e.target.value)}
                placeholder="14:00"
                className="w-14 text-center px-2 py-1 bg-white border-2 border-amber-200 rounded-lg text-xs font-black font-mono text-gray-700"
              />
              <button 
                onClick={handleUpdateHours}
                className="bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-black px-2.5 py-1.5 rounded-lg border-2 border-amber-600 shadow-sm cursor-pointer"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 管理機能タブメニュー */}
      <div className="flex border-b-4 border-gray-100 gap-1.5">
        <button
          onClick={() => setActiveTab("reservations")}
          className={`px-5 py-3 rounded-t-2xl font-black text-xs transition-all cursor-pointer ${
            activeTab === "reservations"
              ? "bg-white border-4 border-b-0 border-[#FED7D7] text-[#E53E3E] -mb-1"
              : "bg-gray-50 hover:bg-gray-100 text-gray-500"
          }`}
        >
          🎟️ 一般予約・受付消込
        </button>
        <button
          onClick={() => setActiveTab("cancelled")}
          className={`px-5 py-3 rounded-t-2xl font-black text-xs transition-all cursor-pointer ${
            activeTab === "cancelled"
              ? "bg-white border-4 border-b-0 border-[#FED7D7] text-[#E53E3E] -mb-1"
              : "bg-gray-50 hover:bg-gray-100 text-gray-500"
          }`}
        >
          📋 キャンセル履歴ログ
        </button>
        <button
          onClick={() => setActiveTab("master")}
          className={`px-5 py-3 rounded-t-2xl font-black text-xs transition-all cursor-pointer ${
            activeTab === "master"
              ? "bg-white border-4 border-b-0 border-[#FED7D7] text-[#E53E3E] -mb-1"
              : "bg-gray-50 hover:bg-gray-100 text-gray-500"
          }`}
        >
          🛠️ マスタ・定員設定
        </button>
        <button
          onClick={() => setActiveTab("gas")}
          className={`px-5 py-3 rounded-t-2xl font-black text-xs transition-all cursor-pointer ${
            activeTab === "gas"
              ? "bg-white border-4 border-b-0 border-[#FED7D7] text-[#E53E3E] -mb-1"
              : "bg-gray-50 hover:bg-gray-100 text-gray-500"
          }`}
        >
          📊 スプレッドシート(GAS)連携
        </button>
      </div>

      {/* タブコンテンツ A: 予約・受付一覧 */}
      {activeTab === "reservations" && (
        <div className="bg-white rounded-[2rem] shadow-md border-4 border-[#FED7D7] overflow-hidden">
          <div className="p-6 bg-[#FFF5F5] border-b-2 border-dashed border-[#FED7D7] flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-black text-gray-800 flex items-center gap-1.5">
                🐾 現在の予約・受付管理シート
              </h3>
              <p className="text-[10px] text-gray-500 font-bold mt-1">
                整理券番号や電話番号でリアルタイムに検索して、来場受付（消込）を行ってください。
              </p>
            </div>

            {/* 検索・フィルター */}
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="text"
                placeholder="🔍 番号・お名前・電話番号で検索"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-white border-2 border-[#FED7D7] rounded-full px-4 py-1.5 text-xs font-black text-gray-700 focus:outline-none focus:border-[#F6AD55] placeholder-gray-400 w-56"
              />
              <select
                value={selectedBoothFilter}
                onChange={(e) => {
                  setSelectedBoothFilter(e.target.value);
                  setSelectedSlotFilter("all");
                }}
                className="bg-white border-2 border-[#FED7D7] rounded-full px-3 py-1.5 text-xs font-black text-gray-700 focus:outline-none focus:border-[#F6AD55]"
              >
                <option value="all">🎪 全ブース</option>
                {booths.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            {filteredReservations.length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                <LucideIcon name="Calendar" size={32} className="text-[#FED7D7] mx-auto mb-2" />
                <p className="text-xs font-black text-gray-500">該当する予約がありません。</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#FFF5F5]/40 text-[10px] font-black text-[#E53E3E] border-b-2 border-dashed border-[#FED7D7]">
                    <th className="p-4">整理券番号</th>
                    <th className="p-4">代表者名（同行者）</th>
                    <th className="p-4">人数</th>
                    <th className="p-4">体験ブース</th>
                    <th className="p-4">時間枠</th>
                    <th className="p-4">状態</th>
                    <th className="p-4 text-center">アクション</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs text-gray-700 font-bold">
                  {filteredReservations.map((res) => {
                    const booth = booths.find(b => b.id === res.animalId);
                    const slot = slots.find(s => s.id === res.slotId);

                    return (
                      <tr 
                        key={res.id} 
                        className={`hover:bg-[#FFF5F5]/20 transition-colors ${
                          res.status === "checked_in" ? "bg-emerald-50/20 text-gray-400" : ""
                        }`}
                      >
                        <td className="p-4 font-mono font-black text-[#E53E3E]">
                          {res.ticketNumber}
                        </td>
                        <td className="p-4">
                          <div>
                            <div className="flex items-center gap-1.5 font-black text-[#2D3748]">
                              {res.userName} 様
                              {res.isAdminAdded && (
                                <span className="bg-[#E6FFFA] text-[#319795] text-[9px] font-black px-1.5 py-0.5 rounded-full border border-[#B2F5EA]">
                                  スタッフ代理
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-gray-400 text-[10px] mt-0.5">{res.phone}</div>
                            {res.companions && res.companions.length > 0 && (
                              <div className="text-[10px] text-gray-400 mt-1 pl-2 border-l-2 border-dashed border-gray-200">
                                同行: {res.companions.map(c => c.name).join(", ")}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="p-4">
                          <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded border border-amber-200">
                            {res.partySize || 1}人
                          </span>
                        </td>
                        <td className="p-4">
                          <span className="text-[10px] bg-[#FFF5F5] border border-[#FED7D7] text-[#E53E3E] font-black px-2 py-0.5 rounded-full">
                            {booth?.name || "不明"}
                          </span>
                        </td>
                        <td className="p-4 font-mono">
                          {slot ? `${slot.startTime}~${slot.endTime}` : "不明"}
                        </td>
                        <td className="p-4">
                          {res.status === "checked_in" ? (
                            <span className="bg-[#E6FFFA] text-[#319795] text-[10px] font-black px-2 py-0.5 rounded-full flex items-center w-max gap-1 border border-[#B2F5EA]">
                              <LucideIcon name="Check" size={11} /> 受付完了
                            </span>
                          ) : (
                            <span className="bg-[#FFF5F5] text-[#E53E3E] text-[10px] font-black px-2 py-0.5 rounded-full flex items-center w-max gap-1 border border-[#FED7D7]">
                              <LucideIcon name="Clock" size={11} /> 未受付
                            </span>
                          )}
                        </td>
                        <td className="p-4 flex items-center justify-center gap-2">
                          {res.status !== "checked_in" ? (
                            <button
                              onClick={() => handleCheckIn(res.id)}
                              className="bg-[#319795] hover:bg-[#287976] text-white text-[10px] font-black px-2.5 py-1.5 rounded-full shadow-sm border-2 border-[#234E52] border-b-4 active:border-b-2 active:translate-y-[2px] transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <LucideIcon name="Check" size={11} /> 受付する
                            </button>
                          ) : (
                            <div className="w-[74px] text-center text-[10px] text-gray-400 font-bold">済</div>
                          )}
                          <button
                            onClick={() => handleCancelReservation(res)}
                            className="bg-white hover:bg-[#FFF5F5] border border-gray-200 hover:border-[#FED7D7] text-gray-400 hover:text-[#E53E3E] p-1.5 rounded-full transition-colors cursor-pointer"
                            title="キャンセル（枠開放）"
                          >
                            <LucideIcon name="Trash2" size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* タブコンテンツ B: キャンセル履歴 */}
      {activeTab === "cancelled" && (
        <div className="bg-white rounded-[2rem] shadow-md border-4 border-[#FED7D7] overflow-hidden">
          <div className="p-6 bg-gray-50 border-b-2 border-dashed border-gray-200">
            <h3 className="text-sm font-black text-gray-800 flex items-center gap-1.5">
              📋 キャンセル履歴確認シート
            </h3>
            <p className="text-[10px] text-gray-500 font-bold mt-1">
              一度予約され、その後お客様またはスタッフの手でキャンセル（時間枠を返却）されたログです。
            </p>
          </div>

          <div className="overflow-x-auto">
            {filteredReservations.length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                <LucideIcon name="Inbox" size={32} className="text-gray-200 mx-auto mb-2" />
                <p className="text-xs font-black text-gray-500">キャンセル履歴はまだありません。</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-[10px] font-black text-gray-500 border-b-2 border-dashed border-gray-200">
                    <th className="p-4">整理券番号</th>
                    <th className="p-4">元予約者名（代表）</th>
                    <th className="p-4">返却人数</th>
                    <th className="p-4">体験ブース</th>
                    <th className="p-4">対象時間枠</th>
                    <th className="p-4">状態</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs text-gray-500 font-bold">
                  {filteredReservations.map((res) => {
                    const booth = booths.find(b => b.id === res.animalId);
                    const slot = slots.find(s => s.id === res.slotId);

                    return (
                      <tr key={res.id} className="bg-gray-50/50">
                        <td className="p-4 font-mono font-bold line-through">
                          {res.ticketNumber}
                        </td>
                        <td className="p-4">
                          <div>
                            <span className="font-bold text-gray-600">{res.userName}</span>
                            <div className="text-[10px] text-gray-400 mt-0.5">{res.phone}</div>
                          </div>
                        </td>
                        <td className="p-4">
                          <span>{res.partySize || 1}人</span>
                        </td>
                        <td className="p-4">
                          <span>{booth?.name || "不明"}</span>
                        </td>
                        <td className="p-4 font-mono">
                          {slot ? `${slot.startTime}〜${slot.endTime}` : "不明"}
                        </td>
                        <td className="p-4">
                          <span className="bg-red-50 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded border border-red-100 flex items-center w-max gap-1">
                            <LucideIcon name="AlertTriangle" size={10} /> キャンセル済 (枠返却)
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* タブコンテンツ C: マスタ設定 (どうぶつ追加・時間枠追加・定員変更) */}
      {activeTab === "master" && (
        <div className="space-y-6">
          {/* C-1: 動物追加 ＆ 時間帯追加 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 動物追加 */}
            <div className="bg-white rounded-[2rem] p-6 shadow-md border-4 border-[#FED7D7] space-y-4">
              <h3 className="text-sm font-black text-gray-800 flex items-center gap-1.5 border-b border-gray-100 pb-2">
                <span>🐶</span> 体験どうぶつの新規追加
              </h3>
              
              <form onSubmit={handleAddBooth} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 mb-1">ブースID (英数半角のみ)</label>
                  <input 
                    type="text" 
                    placeholder="例: panda"
                    value={newBoothId}
                    onChange={(e) => setNewBoothId(e.target.value)}
                    className="w-full px-3 py-1.5 border-2 border-gray-200 rounded-xl text-xs font-black bg-gray-50 focus:outline-none focus:border-[#E53E3E]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 mb-1">ブース名</label>
                  <input 
                    type="text" 
                    placeholder="例: パンダころころハウス 🐼"
                    value={newBoothName}
                    onChange={(e) => setNewBoothName(e.target.value)}
                    className="w-full px-3 py-1.5 border-2 border-gray-200 rounded-xl text-xs font-black bg-gray-50 focus:outline-none focus:border-[#E53E3E]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 mb-1">ブース説明</label>
                  <textarea 
                    placeholder="例: 新たに仲間入りしたパンダさん。ゴロゴロ転がる姿が最高にキュート！"
                    value={newBoothDesc}
                    onChange={(e) => setNewBoothDesc(e.target.value)}
                    className="w-full px-3 py-1.5 border-2 border-gray-200 rounded-xl text-xs font-black bg-gray-50 focus:outline-none focus:border-[#E53E3E] h-16"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 mb-1">アイコン</label>
                    <select
                      value={newBoothIcon}
                      onChange={(e) => setNewBoothIcon(e.target.value)}
                      className="w-full px-3 py-1.5 border-2 border-gray-200 rounded-xl text-xs font-black bg-white focus:outline-none"
                    >
                      <option value="Dog">Dog 🐶</option>
                      <option value="Cat">Cat 🐱</option>
                      <option value="Rabbit">Rabbit 🐰</option>
                      <option value="Sparkles">Sparkles ✨</option>
                      <option value="Heart">Heart ❤️</option>
                      <option value="Smile">Smile 😊</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 mb-1">テーマカラー</label>
                    <select
                      value={newBoothColor}
                      onChange={(e) => setNewBoothColor(e.target.value)}
                      className="w-full px-3 py-1.5 border-2 border-gray-200 rounded-xl text-xs font-black bg-white focus:outline-none"
                    >
                      <option value="bg-red-500">Red (えんじレッド)</option>
                      <option value="bg-teal-500">Teal (ねこミント)</option>
                      <option value="bg-amber-500">Amber (うさぎオレンジ)</option>
                      <option value="bg-blue-500">Blue (ハムスターブルー)</option>
                      <option value="bg-purple-500">Purple (パープル)</option>
                    </select>
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full bg-[#E53E3E] hover:bg-[#C53030] text-white font-black py-2.5 rounded-xl text-xs border-4 border-[#9B2C2C] border-b-6 active:border-b-2 active:translate-y-[2px] cursor-pointer"
                >
                  どうぶつブースを登録 🐾
                </button>
              </form>
            </div>

            {/* 時間帯追加 */}
            <div className="bg-white rounded-[2rem] p-6 shadow-md border-4 border-[#FED7D7] space-y-4">
              <h3 className="text-sm font-black text-gray-800 flex items-center gap-1.5 border-b border-gray-100 pb-2">
                <span>🕒</span> 体験時間枠の新規追加
              </h3>
              
              <form onSubmit={handleAddSlot} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 mb-1">対象のどうぶつブース</label>
                  <select
                    value={newSlotBoothId}
                    onChange={(e) => setNewSlotBoothId(e.target.value)}
                    className="w-full px-3 py-1.5 border-2 border-gray-200 rounded-xl text-xs font-black bg-white focus:outline-none focus:border-[#E53E3E]"
                  >
                    <option value="">-- 選択してください --</option>
                    {booths.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 mb-1">開始時刻 (例: 11:30)</label>
                    <input 
                      type="text" 
                      placeholder="11:30"
                      value={newSlotStart}
                      onChange={(e) => setNewSlotStart(e.target.value)}
                      className="w-full px-3 py-1.5 border-2 border-gray-200 rounded-xl text-xs font-black bg-gray-50 font-mono text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 mb-1">終了時刻 (例: 12:00)</label>
                    <input 
                      type="text" 
                      placeholder="12:00"
                      value={newSlotEnd}
                      onChange={(e) => setNewSlotEnd(e.target.value)}
                      className="w-full px-3 py-1.5 border-2 border-gray-200 rounded-xl text-xs font-black bg-gray-50 font-mono text-center"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 mb-1">定員 (予約可能枠数・名)</label>
                  <input 
                    type="number" 
                    value={newSlotCapacity}
                    onChange={(e) => setNewSlotCapacity(Number(e.target.value))}
                    min={1}
                    className="w-full px-3 py-1.5 border-2 border-gray-200 rounded-xl text-xs font-black bg-gray-50 text-center"
                  />
                </div>

                <button 
                  type="submit"
                  className="w-full bg-[#319795] hover:bg-[#287976] text-white font-black py-2.5 rounded-xl text-xs border-4 border-[#234E52] border-b-6 active:border-b-2 active:translate-y-[2px] cursor-pointer"
                >
                  時間帯スロットを登録 🕒
                </button>
              </form>
            </div>
          </div>

          {/* C-2: 定員変更 ＆ スロット一覧管理 */}
          <div className="bg-white rounded-[2rem] p-6 shadow-md border-4 border-[#FED7D7] space-y-4">
            <h3 className="text-sm font-black text-gray-800 flex items-center gap-1.5 border-b border-gray-100 pb-2">
              <span>📊</span> 時間帯スロットの個別定員変更
            </h3>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse font-bold text-gray-700">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 border-b border-gray-200">
                    <th className="p-3">どうぶつブース</th>
                    <th className="p-3">時間帯</th>
                    <th className="p-3 text-center">定員数</th>
                    <th className="p-3 text-center">現在の予約数</th>
                    <th className="p-3 text-center">アクション</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {slots.map(s => {
                    const b = booths.find(booth => booth.id === s.animalId);
                    const isEditing = editingSlotId === s.id;

                    return (
                      <tr key={s.id} className="hover:bg-gray-50/50">
                        <td className="p-3">
                          <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full border border-gray-200">
                            {b?.name || "不明"}
                          </span>
                        </td>
                        <td className="p-3 font-mono">{s.startTime}~{s.endTime}</td>
                        <td className="p-3 text-center">
                          {isEditing ? (
                            <input 
                              type="number"
                              value={editingCapacityVal}
                              onChange={(e) => setEditingCapacityVal(Number(e.target.value))}
                              min={1}
                              className="w-16 px-1.5 py-0.5 border-2 border-amber-300 rounded text-center text-xs font-black focus:outline-none"
                            />
                          ) : (
                            <span className="font-mono text-sm font-black">{s.capacity}名</span>
                          )}
                        </td>
                        <td className="p-3 text-center font-mono">
                          <span className={`${s.bookedCount >= s.capacity ? "text-red-500 font-black" : "text-gray-500"}`}>
                            {s.bookedCount || 0}名
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          {isEditing ? (
                            <div className="flex justify-center gap-1">
                              <button 
                                onClick={() => handleUpdateSlotCapacity(s.id)}
                                className="bg-emerald-500 text-white text-[10px] px-2.5 py-1 rounded cursor-pointer font-black"
                              >
                                保存
                              </button>
                              <button 
                                onClick={() => setEditingSlotId(null)}
                                className="bg-gray-200 text-gray-600 text-[10px] px-2.5 py-1 rounded cursor-pointer font-black"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button 
                              onClick={() => {
                                setEditingSlotId(s.id);
                                setEditingCapacityVal(s.capacity);
                              }}
                              className="bg-amber-400 hover:bg-amber-500 text-white text-[10px] px-2.5 py-1 rounded cursor-pointer font-black"
                            >
                              定員を変更する ⚙️
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* タブコンテンツ D: スプレッドシート(GAS) 連携設定 */}
      {activeTab === "gas" && (
        <div className="bg-white rounded-[2rem] shadow-md border-4 border-[#FED7D7] overflow-hidden animate-scale-in">
          {/* ヘッダー */}
          <div className="p-6 bg-[#FFF5F5] border-b-2 border-dashed border-[#FED7D7]">
            <h3 className="text-sm font-black text-gray-800 flex items-center gap-1.5">
              📊 Googleスプレッドシート & GAS 連携設定
            </h3>
            <p className="text-[10px] text-gray-500 font-bold mt-1">
              本システムのデータベースを Firebase から、使い慣れた Googleスプレッドシート ＋ Apps Script (GAS) に切り替えることができます。
            </p>
          </div>

          <div className="p-6 space-y-6">
            {/* 接続ステータスカード */}
            <div className={`p-5 rounded-3xl border-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-all ${
              gasApiUrl 
                ? "bg-emerald-50 border-emerald-200 text-emerald-950" 
                : "bg-amber-50 border-amber-200 text-amber-950"
            }`}>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`w-3.5 h-3.5 rounded-full block animate-pulse ${gasApiUrl ? "bg-emerald-500" : "bg-amber-500"}`}></span>
                  <strong className="text-xs font-black">
                    {gasApiUrl ? "🟢 Googleスプレッドシート同期モード：有効" : "🟠 Firebase Firestore 動作モード（ローカル/クラウド）"}
                  </strong>
                </div>
                <p className="text-[10px] text-gray-500 font-bold leading-relaxed">
                  {gasApiUrl 
                    ? `現在、すべての予約受付・時間枠・設定データは Googleスプレッドシート から 10秒毎にリアルタイムで双方向同期されています。` 
                    : "現在は、スプレッドシートと同期していません。下記のステップに沿ってGASをデプロイし、接続するとスプレッドシートをマスターDBとして利用できます。"}
                </p>
                {gasApiUrl && (
                  <div className="mt-1 text-[10px] font-mono font-bold bg-white/60 px-3 py-1 rounded-xl border border-emerald-200 break-all">
                    URL: {gasApiUrl}
                  </div>
                )}
              </div>

              {gasApiUrl ? (
                <button
                  type="button"
                  onClick={handleDisconnectGasUrl}
                  className="bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-black px-4 py-2.5 rounded-2xl border-4 border-rose-700 border-b-8 active:border-b-4 active:translate-y-[2px]"
                >
                  🔌 接続を解除する
                </button>
              ) : (
                <div className="text-[10px] bg-amber-200/50 text-amber-800 font-black px-3 py-1.5 rounded-xl border border-amber-300">
                  未接続
                </div>
              )}
            </div>

            {/* URL設定フォーム */}
            <div className="bg-gray-50 p-5 rounded-3xl border-4 border-gray-100 space-y-3">
              <h4 className="text-xs font-black text-gray-800 flex items-center gap-1.5">
                🔗 GAS ウェブアプリ URL の登録
              </h4>
              <p className="text-[10px] text-gray-500 font-bold leading-relaxed">
                Google Apps Script (GAS) をデプロイして取得した「ウェブアプリのURL」を入力し、「同期テスト＆保存」を押してください。
              </p>
              
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  value={gasUrlInput}
                  onChange={(e) => setGasUrlInput(e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="flex-1 bg-white border-2 border-gray-200 rounded-2xl px-4 py-2.5 text-xs font-bold focus:outline-none focus:border-[#E53E3E]"
                  disabled={isSavingGasUrl}
                />
                <button
                  type="button"
                  onClick={handleSaveGasUrl}
                  disabled={isSavingGasUrl}
                  className="bg-[#E53E3E] hover:bg-[#C53030] text-white text-xs font-black px-5 py-2.5 rounded-2xl border-4 border-[#9B2C2C] border-b-8 active:border-b-4 active:translate-y-[2px] disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0"
                >
                  {isSavingGasUrl ? (
                    <>
                      <LucideIcon name="RefreshCw" className="animate-spin" size={14} />
                      接続確認中...
                    </>
                  ) : (
                    <>
                      <LucideIcon name="Link" size={14} />
                      同期テスト＆保存 🐾
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 導入手順ステップ */}
            <div className="bg-white rounded-3xl border-4 border-[#FED7D7] p-5 space-y-4">
              <h4 className="text-xs font-black text-[#E53E3E] flex items-center gap-1.5">
                🚀 4ステップでかんたん接続！
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="bg-rose-50/40 p-3 rounded-2xl border border-rose-100 space-y-1">
                  <span className="text-[10px] bg-[#E53E3E] text-white font-black px-2 py-0.5 rounded-full">STEP 1</span>
                  <p className="text-[10px] font-black text-gray-800">スプレッドシートの作成</p>
                  <p className="text-[9px] text-gray-500 font-bold leading-relaxed">
                    Google ドライブで新規スプレッドシートを作成し、その「スプレッドシートID」を控えます。
                  </p>
                </div>
                <div className="bg-rose-50/40 p-3 rounded-2xl border border-rose-100 space-y-1">
                  <span className="text-[10px] bg-[#E53E3E] text-white font-black px-2 py-0.5 rounded-full">STEP 2</span>
                  <p className="text-[10px] font-black text-gray-800">GASエディタの起動</p>
                  <p className="text-[9px] text-gray-500 font-bold leading-relaxed">
                    スプレッドシートの「拡張機能」＞「Apps Script」を選択し、エディタを開きます。
                  </p>
                </div>
                <div className="bg-rose-50/40 p-3 rounded-2xl border border-rose-100 space-y-1">
                  <span className="text-[10px] bg-[#E53E3E] text-white font-black px-2 py-0.5 rounded-full">STEP 3</span>
                  <p className="text-[10px] font-black text-gray-800">コードをコピー＆貼付</p>
                  <p className="text-[9px] text-gray-500 font-bold leading-relaxed">
                    下記の <strong className="text-rose-700">Code.js</strong> の中身をエディタに貼り付け、IDを書き換えて保存します。
                  </p>
                </div>
                <div className="bg-rose-50/40 p-3 rounded-2xl border border-rose-100 space-y-1">
                  <span className="text-[10px] bg-[#E53E3E] text-white font-black px-2 py-0.5 rounded-full">STEP 4</span>
                  <p className="text-[10px] font-black text-gray-800">ウェブアプリでデプロイ</p>
                  <p className="text-[9px] text-gray-500 font-bold leading-relaxed">
                    「新しいデプロイ」で種類を「ウェブアプリ」にし、アクセスを「全員」にしてデプロイします。
                  </p>
                </div>
              </div>
            </div>

            {/* ソースコードコピーパネル */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-gray-800 flex items-center gap-1.5">
                📝 コピペ用 Apps Script ソースコード
              </h4>

              {/* Code.js */}
              <div className="bg-[#2D3748] rounded-3xl overflow-hidden shadow-inner border-4 border-gray-700">
                <div className="px-5 py-3 bg-[#1A202C] flex items-center justify-between text-gray-300 text-[10px] font-mono border-b border-gray-700">
                  <span className="flex items-center gap-1.5 font-bold text-slate-100">
                    📄 Code.js (Apps Script サーバーサイド)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(codeJsText);
                      setCopiedType("code");
                      setTimeout(() => setCopiedType(null), 2000);
                    }}
                    className="bg-[#4A5568] hover:bg-[#718096] text-white text-[9px] font-black px-3 py-1.5 rounded-xl border border-gray-600 transition-colors cursor-pointer flex items-center gap-1"
                  >
                    {copiedType === "code" ? (
                      <>
                        <LucideIcon name="Check" size={10} />
                        コピーしました！
                      </>
                    ) : (
                      <>
                        <LucideIcon name="Copy" size={10} />
                        コードをコピー
                      </>
                    )}
                  </button>
                </div>
                <div className="p-4 overflow-x-auto max-h-[220px] scrollbar-thin">
                  <pre className="text-[10px] font-mono text-gray-300 leading-relaxed select-all">
                    {codeJsText}
                  </pre>
                </div>
              </div>

              {/* Index.html */}
              <div className="bg-[#2D3748] rounded-3xl overflow-hidden shadow-inner border-4 border-gray-700">
                <div className="px-5 py-3 bg-[#1A202C] flex items-center justify-between text-gray-300 text-[10px] font-mono border-b border-gray-700">
                  <span className="flex items-center gap-1.5 font-bold text-slate-100">
                    📄 Index.html (GAS HTML Service用)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(indexHtmlText);
                      setCopiedType("html");
                      setTimeout(() => setCopiedType(null), 2000);
                    }}
                    className="bg-[#4A5568] hover:bg-[#718096] text-white text-[9px] font-black px-3 py-1.5 rounded-xl border border-gray-600 transition-colors cursor-pointer flex items-center gap-1"
                  >
                    {copiedType === "html" ? (
                      <>
                        <LucideIcon name="Check" size={10} />
                        コピーしました！
                      </>
                    ) : (
                      <>
                        <LucideIcon name="Copy" size={10} />
                        コードをコピー
                      </>
                    )}
                  </button>
                </div>
                <div className="p-4 overflow-x-auto max-h-[220px] scrollbar-thin">
                  <pre className="text-[10px] font-mono text-gray-300 leading-relaxed select-all">
                    {indexHtmlText}
                  </pre>
                </div>
              </div>

              {/* 案内 */}
              <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200 flex items-start gap-2.5 text-[10px] text-amber-900 leading-relaxed font-bold">
                <div className="text-amber-600 mt-0.5 shrink-0">
                  <LucideIcon name="Info" size={14} />
                </div>
                <div>
                  <strong>💡 GAS HTML Service上で独立したWebアプリとして動かす場合：</strong>
                  <br />
                  上記 <span className="underline">Index.html</span> をGAS内に新規HTMLファイルとして作成し（名前を `Index` にする）、デプロイしてください。これにより、このReactシステム全体の美しいUIとアニメーションがスプレッドシートをDBとして動作する、完全な独立Webアプリとして学園祭の現場で即座に機能するようになります！🐾
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 代理予約モーダル (スマホなし来場者向け) */}
      {isProxyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white rounded-[2.5rem] max-w-lg w-full p-6 shadow-[8px_8px_0px_#2D3748] border-4 border-[#E53E3E] relative my-8">
            <button 
              onClick={() => setIsProxyModalOpen(false)}
              className="absolute top-5 right-5 text-gray-400 hover:text-gray-600 bg-[#FFF5F5] p-1.5 rounded-full border-2 border-[#FED7D7]"
            >
              <LucideIcon name="X" size={20} />
            </button>

            <div className="text-center mb-5 mt-2">
              <span className="inline-block bg-[#E6FFFA] text-[#319795] p-3 rounded-2xl border-2 border-[#B2F5EA] mb-2 animate-bounce">
                <LucideIcon name="Users" size={26} />
              </span>
              <h3 className="text-lg font-black text-gray-800">現地・代理予約 (スマホをお持ちでない方向け)</h3>
              <p className="text-xs text-gray-500 font-bold mt-1">
                お客様に代わって代表者情報、体験人数、同行者情報を指定し、直接その場で整理券を追加発行します。
              </p>
            </div>

            <form onSubmit={handleProxyBooking} className="space-y-4">
              <div className="bg-[#FFF5F5]/50 p-4 rounded-3xl border-2 border-[#FED7D7] space-y-3">
                <h4 className="text-xs font-black text-[#E53E3E]">👤 代表者さま（お客様）情報</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 mb-1">お名前 (代表) *</label>
                    <input 
                      type="text" 
                      placeholder="例：山田 はなこ"
                      value={proxyName}
                      onChange={(e) => setProxyName(e.target.value)}
                      className="w-full px-3 py-1.5 border-2 border-gray-200 rounded-xl text-xs font-black bg-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 mb-1">電話番号 *</label>
                    <input 
                      type="tel" 
                      placeholder="例：09012345678"
                      value={proxyPhone}
                      onChange={(e) => setProxyPhone(e.target.value)}
                      maxLength={11}
                      className="w-full px-3 py-1.5 border-2 border-gray-200 rounded-xl text-xs font-black bg-white"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 mb-1">関係性</label>
                  <select
                    value={proxyRelationship}
                    onChange={(e) => setProxyRelationship(e.target.value)}
                    className="w-full px-3 py-1.5 border-2 border-gray-200 rounded-xl text-xs font-black bg-white"
                  >
                    <option value="一般">一般</option>
                    <option value="学生">学生</option>
                    <option value="学生保護者">学生保護者</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-500 mb-1">
                  体験時間枠の特定 <span className="text-[#E53E3E] font-bold">*</span>
                </label>
                <select
                  value={proxySlotId}
                  onChange={(e) => setProxySlotId(e.target.value)}
                  className="w-full px-3.5 py-2.5 border-4 border-[#FED7D7] rounded-2xl text-xs font-black text-gray-700 bg-white focus:border-[#F6AD55] focus:outline-none"
                  required
                >
                  <option value="">-- 予約するスロットを選択してください --</option>
                  {availableSlotsForProxy.map(s => {
                    const b = booths.find(booth => booth.id === s.animalId);
                    const remaining = s.capacity - s.bookedCount;
                    return (
                      <option 
                        key={s.id} 
                        value={s.id}
                        disabled={remaining <= 0}
                      >
                        [{b?.name.replace(/🐶|🐱|🐰|🐹/g, "").trim().substring(0,4)}] {s.startTime}〜{s.endTime} (残り {remaining} 席 / 定員 {s.capacity})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* 代理人数選択 */}
              <div className="bg-amber-50/20 p-4 rounded-3xl border-2 border-dashed border-amber-200 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-gray-700">👥 体験人数（代表＋同行者）</label>
                  <div className="flex items-center gap-1 bg-white p-1 rounded-2xl border border-gray-200">
                    {[1, 2, 3, 4].map(num => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => handleProxyPartySizeChange(num)}
                        className={`px-3 py-1 rounded-xl text-xs font-black transition-all ${
                          proxyPartySize === num ? "bg-[#319795] text-white" : "text-gray-500 hover:bg-gray-50"
                        }`}
                      >
                        {num}人
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 代理同行者入力 */}
              {proxyPartySize > 1 && (
                <div className="bg-blue-50/50 p-4 rounded-3xl border-2 border-dashed border-blue-200 space-y-3 animate-scale-in">
                  <h4 className="text-xs font-black text-blue-600">🐾 同行者さま情報</h4>
                  {proxyCompanions.map((comp, idx) => (
                    <div key={idx} className="p-3 bg-white rounded-2xl border border-blue-100 space-y-2.5">
                      <span className="text-[10px] bg-blue-50 text-blue-600 font-black px-2 py-0.5 rounded-full">
                        同行者 {idx + 1}
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] font-black text-gray-500 mb-0.5">お名前</label>
                          <input 
                            type="text" 
                            placeholder="例：山田 太郎"
                            value={comp.name}
                            onChange={(e) => handleProxyCompanionChange(idx, "name", e.target.value)}
                            className="w-full px-2.5 py-1 border border-gray-200 rounded-lg text-xs font-black"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-black text-gray-500 mb-0.5">電話番号</label>
                          <input 
                            type="tel" 
                            placeholder="例：09088889999"
                            value={comp.phone}
                            onChange={(e) => handleProxyCompanionChange(idx, "phone", e.target.value)}
                            maxLength={11}
                            className="w-full px-2.5 py-1 border border-gray-200 rounded-lg text-xs font-black"
                            required
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {proxyError && (
                <p className="text-xs text-[#E53E3E] font-black bg-[#FFF5F5] border-2 border-[#FED7D7] p-2.5 rounded-xl text-center flex items-center justify-center gap-1">
                  <LucideIcon name="AlertCircle" size={14} /> {proxyError}
                </p>
              )}

              {proxySuccess && (
                <p className="text-xs text-[#319795] font-black bg-[#E6FFFA] border-2 border-[#B2F5EA] p-2.5 rounded-xl text-center flex items-center justify-center gap-1 animate-pulse">
                  <LucideIcon name="Check" size={14} /> {proxySuccess}
                </p>
              )}

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsProxyModalOpen(false)}
                  className="flex-1 bg-white text-gray-700 font-black py-3 rounded-2xl text-xs border-4 border-[#E2E8F0] border-b-8 active:border-b-4 active:translate-y-[2px]"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  id="btn-confirm-proxy-booking"
                  className="flex-[2] bg-[#319795] hover:bg-[#287976] text-white font-black py-3 rounded-2xl shadow-sm text-xs border-4 border-[#234E52] border-b-8 active:border-b-4 active:translate-y-[2px] cursor-pointer"
                >
                  代理整理券を発行 🐾
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
