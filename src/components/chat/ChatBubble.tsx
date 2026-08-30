"use client";

import { motion } from "framer-motion";

import { formatChatTime } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

interface ChatBubbleProps {
  content: string;
  createdAt: string;
  /** left = received (admin/customer partner), right = sent by current user */
  side: "left" | "right";
}

/**
 * A single chat message bubble. Message text is rendered as plain text
 * (never dangerouslySetInnerHTML) with `whitespace-pre-wrap break-words`
 * so multi-line messages and long unbroken strings behave.
 */
export function ChatBubble({ content, createdAt, side }: ChatBubbleProps) {
  const isRight = side === "right";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn("flex", isRight ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[85%] sm:max-w-[75%] md:max-w-[65%] rounded-2xl px-3.5 py-2",
          isRight
            ? "rounded-br-md bg-emerald-600 text-white"
            : "rounded-bl-md border bg-card text-foreground shadow-sm"
        )}
      >
        <p className="whitespace-pre-wrap break-words text-sm">{content}</p>
        <span className="mt-1 block text-right text-[10px] opacity-70">
          {formatChatTime(createdAt)}
        </span>
      </div>
    </motion.div>
  );
}
