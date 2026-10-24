"use client";

import { useEffect } from "react";

export function DraftCleanup({ orderId, submissionKey }: { orderId: string; submissionKey: string | null }) {
  useEffect(() => {
    localStorage.removeItem(`order:edit:${orderId}`);
    if (!submissionKey) return;
    try {
      const draft = JSON.parse(localStorage.getItem("order:new") ?? "null") as { submissionKey?: string } | null;
      if (draft?.submissionKey === submissionKey) localStorage.removeItem("order:new");
    } catch { /* starý nečitateľný koncept zostáva nedotknutý */ }
  }, [orderId, submissionKey]);
  return null;
}
