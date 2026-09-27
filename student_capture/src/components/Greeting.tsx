"use client";

import { useEffect, useState } from "react";

export function partOfDay(hour: number): string {
  if (hour >= 4 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 17) return "Afternoon";
  return "Evening";
}

/**
 * "Morning, Ali" by the student's own clock. The server only knows UTC, so it
 * renders "Hi, Ali" and the browser swaps in the part of the day.
 */
export function Greeting({ name }: { name: string | null }) {
  const [salutation, setSalutation] = useState("Hi");
  useEffect(() => setSalutation(partOfDay(new Date().getHours())), []);
  return (
    <p className="mb-1 text-lg font-semibold tracking-tight">
      {name ? `${salutation}, ${name}` : salutation === "Hi" ? "Hi there" : `Good ${salutation.toLowerCase()}`}
    </p>
  );
}
