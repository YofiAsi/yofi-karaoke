"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";
import { createUser, loadStoredUser } from "@/lib/user";

export default function NamePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const existing = loadStoredUser();
    if (existing) router.replace("/");
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await createUser(trimmed);
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError && err.code === "host_name_taken") {
        setError(
          "That host name is already active. Wait 30 seconds or pick another.",
        );
      } else {
        setError("Could not join. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm flex flex-col gap-4"
      >
        <h1 className="text-3xl font-semibold">Karaoke</h1>
        <p className="text-sm text-neutral-400">
          Pick a name so everyone knows who queued what.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={40}
          className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 text-lg outline-none focus:border-neutral-500"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="w-full rounded-lg bg-white text-black font-semibold py-3 disabled:opacity-40"
        >
          {submitting ? "Joining…" : "Join"}
        </button>
      </form>
    </main>
  );
}
