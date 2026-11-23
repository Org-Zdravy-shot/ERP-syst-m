"use client";
import { useActionState } from "react";
import { btnPrimary, btnSecondary, errorBox } from "@/components/ui";
import { generateRecurringAction, pauseRecurringAction } from "./_actions";

export function ScheduleActions({ id, paused, next, due }: { id: string; paused: boolean; next: string; due: boolean }) {
  const [pause, pauseAction, pausing] = useActionState(pauseRecurringAction.bind(null, id, !paused), {});
  const [generated, generate, generating] = useActionState(generateRecurringAction.bind(null, id, next), {});
  return <div className="flex flex-wrap gap-2">
    {next && <form action={pauseAction}><button className={btnSecondary} disabled={pausing}>{paused ? "Obnoviť plán" : "Pozastaviť"}</button></form>}
    {due && !paused && <form action={generate}><button className={btnPrimary} disabled={generating}>{generating ? "Tvorím…" : "Vytvoriť koncept"}</button></form>}
    {(pause.error || generated.error) && <p role="alert" className={errorBox}>{pause.error ?? generated.error}</p>}
  </div>;
}
