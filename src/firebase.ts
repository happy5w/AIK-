import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  writeBatch,
  query,
  where
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";
import { AnimalBooth, TimeSlot, SystemSettings } from "./types";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// 初期データ定義
export const INITIAL_BOOTHS: AnimalBooth[] = [
  {
    id: "dog1",
    name: "犬1 🐾",
    description: "人懐っこくて元気いっぱいなワンちゃん1号！なでなでおやつ体験もできるよ。",
    icon: "Dog",
    color: "bg-[#E53E3E]" // 赤
  },
  {
    id: "dog2",
    name: "犬2 🐕",
    description: "おっとりマイペースで癒やし系なワンちゃん2号。優しくなでてあげてね。",
    icon: "Dog",
    color: "bg-[#DD6B20]" // オレンジ
  },
  {
    id: "dog3",
    name: "犬3 🐩",
    description: "お利口さんで遊びが大好きなワンちゃん3号。お友達になろう！",
    icon: "Dog",
    color: "bg-[#D69E2E]" // 黄
  },
  {
    id: "cat",
    name: "ねこ 🐱",
    description: "気まぐれで愛らしいねこちゃんたち。のんびり自由な時間を過ごそう。",
    icon: "Cat",
    color: "bg-[#319795]" // ティール
  },
  {
    id: "small_animal",
    name: "小動物 🐹",
    description: "うさぎやハムスターなど、ちいさくて可愛い動物たちと触れ合えるよ。",
    icon: "Rabbit",
    color: "bg-[#805AD5]" // 紫
  }
];

// 11:00 〜 14:00 までの時間枠を生成 (1枠30分、全6枠)
export const generateDefaultSlots = (animalId: string, capacity: number): Omit<TimeSlot, 'id' | 'bookedCount'>[] => {
  const slots: Omit<TimeSlot, 'id' | 'bookedCount'>[] = [];
  const times = [
    { start: "11:00", end: "11:30" },
    { start: "11:30", end: "12:00" },
    { start: "12:00", end: "12:30" },
    { start: "12:30", end: "13:00" },
    { start: "13:00", end: "13:30" },
    { start: "13:30", end: "14:00" }
  ];
  
  times.forEach(t => {
    slots.push({
      animalId,
      startTime: t.start,
      endTime: t.end,
      capacity
    });
  });
  
  return slots;
};

// データベースの初期設定を行う関数
export async function initializeDatabase(force: boolean = false) {
  try {
    const settingsDocRef = doc(db, "system", "settings");
    
    // すでにデータがあるか確認
    const boothsSnapshot = await getDocs(collection(db, "booths"));
    const existingIds = boothsSnapshot.docs.map(d => d.id);
    const targetIds = INITIAL_BOOTHS.map(b => b.id);
    
    // ターゲットのIDリストと既存のIDリストが一致しているか確認
    const isMatched = existingIds.length === targetIds.length && existingIds.every(id => targetIds.includes(id));
    
    if (!force && isMatched) {
      console.log("Database already initialized and matches configuration.");
      return;
    }

    console.log("Initializing database (or resetting due to configuration change) with default values...");
    const batch = writeBatch(db);

    // 1. システム設定
    const defaultSettings: SystemSettings = {
      isBookingOpen: true,
      simulationDate: new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-'),
      adminPasscode: "fes123"
    };
    batch.set(settingsDocRef, defaultSettings);

    // 古いブース情報を削除
    boothsSnapshot.forEach(boothDoc => {
      batch.delete(boothDoc.ref);
    });

    // 2. 新しいブース情報を追加
    INITIAL_BOOTHS.forEach(booth => {
      const boothRef = doc(db, "booths", booth.id);
      batch.set(boothRef, booth);
    });

    // 3. 時間枠 (スロット)
    // 一度古いスロットを削除
    const slotsSnapshot = await getDocs(collection(db, "slots"));
    slotsSnapshot.forEach(slotDoc => {
      batch.delete(slotDoc.ref);
    });

    // デフォルトスロットの追加
    const capacity = 5; // すべての枠を5人限定にする

    INITIAL_BOOTHS.forEach(booth => {
      const slots = generateDefaultSlots(booth.id, capacity);
      
      slots.forEach((slot, index) => {
        const slotId = `${booth.id}_slot_${index}`;
        const slotRef = doc(db, "slots", slotId);
        batch.set(slotRef, {
          id: slotId,
          ...slot,
          bookedCount: 0
        });
      });
    });

    await batch.commit();
    console.log("Database initialized successfully!");
  } catch (error) {
    console.error("Error during database initialization: ", error);
    throw error;
  }
}
