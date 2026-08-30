"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/** Curated emoji set (8 categories × ~18) — small, zero-dependency picker. */
const CATEGORIES: { name: string; emojis: string[] }[] = [
  {
    name: "Wajah",
    emojis: [
      "😀", "😁", "😂", "🤣", "😊", "😇", "🙂", "😉", "😍", "🥰", "😘", "😋",
      "😛", "🤪", "🤨", "🧐", "🤓", "😎", "🥳", "😏", "😌", "😔", "😪", "🥱",
      "😴", "🤤", "😭", "😤", "😡", "🤯", "😱", "🥺", "😣", "😅", "🙄", "🤔",
    ],
  },
  {
    name: "Gestur",
    emojis: [
      "👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "👏", "🙌", "🤝", "🙏", "💪",
      "👋", "🖐️", "✋", "🤙", "👀", "🧠", "❤️", "🧡", "💛", "💚", "💙", "💜",
    ],
  },
  {
    name: "Aktivitas",
    emojis: [
      "✅", "❌", "⭕", "❗", "❓", "💤", "🔥", "✨", "⭐", "🎉", "🎊", "🎈",
      "🏆", "🎯", "🎮", "⚽", "🏀", "🎵", "🎧", "📲", "💬", "💭", "🔔", "📌",
    ],
  },
  {
    name: "Objek",
    emojis: [
      "📦", "🛒", "🛍️", "💸", "💳", "💰", "🧾", "📱", "💻", "⌚", "📷", "🎁",
      "🚚", "🛵", "✈️", "🏠", "🏢", "🕐", "📅", "🔧", "🛠️", "🔑", "💡", "🔋",
    ],
  },
  {
    name: "Makanan",
    emojis: [
      "☕", "🍵", "🧋", "🥤", "🍚", "🍜", "🍝", "🍕", "🍔", "🍟", "🍗", "🥘",
      "🍛", "🍣", "🍩", "🍪", "🎂", "🍰", "🍫", "🍓", "🍉", "🍇", "🥑", "🌶️",
    ],
  },
  {
    name: "Alam",
    emojis: [
      "🐶", "🐱", "🐦", "🐟", "🦋", "🌸", "🌺", "🌻", "🌴", "🌵", "🍀", "🌙",
      "☀️", "⛅", "🌈", "⚡", "🌧️", "❄️", "🌊", "🌍",
    ],
  },
];

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
  className?: string;
}

/**
 * Lightweight emoji grid (no dependency). Click-outside + Escape close it.
 */
export function EmojiPicker({ onPick, onClose, className }: EmojiPickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Pilih emoji"
      className={cn(
        "absolute bottom-full z-20 mb-2 max-h-72 w-72 overflow-y-auto rounded-xl border bg-popover p-2 shadow-lg chat-scroll",
        className
      )}
    >
      {CATEGORIES.map((cat) => (
        <div key={cat.name} className="mb-1.5">
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {cat.name}
          </p>
          <div className="grid grid-cols-8 gap-0.5">
            {cat.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="flex size-8 items-center justify-center rounded-md text-lg hover:bg-accent"
                aria-label={`Emoji ${emoji}`}
                onClick={() => onPick(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
