"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { PostDetail } from "@/components/PostDetail";
import { useFeedStore } from "@/store/useFeedStore";
import type { PostDTO } from "@/lib/types";

export default function PostPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const fromStore = useFeedStore((s) => s.posts.find((p) => p.id === id));
  const [mounted, setMounted] = useState(false);
  const [fetched, setFetched] = useState<PostDTO | null>(null);
  const [fetching, setFetching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isMock = typeof id === "string" && id.startsWith("mock-");

  useEffect(() => {
    if (!mounted || !id || fromStore || isMock) return;
    let cancelled = false;
    setFetching(true);
    setNotFound(false);
    setError(null);
    fetch(`/api/posts/${id}`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) {
          setError(`request failed (${res.status})`);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        useFeedStore.getState().upsertPost(data.post, false);
        setFetched(data.post);
      })
      .catch(() => {
        if (!cancelled) setError("network error");
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mounted, id, fromStore, isMock]);

  if (!mounted) {
    return (
      <div className="p-4 font-mono text-xs text-slate-500">loading…</div>
    );
  }

  const post = fromStore ?? (fetched && fetched.id === id ? fetched : null);

  return (
    <div className="flex h-screen flex-col p-4">
      <TopBar />
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded border border-slate-800">
        {notFound || (isMock && !fromStore) ? (
          <div className="p-4 font-mono text-xs text-slate-400">
            <p>Article not found.</p>
            <Link href="/" className="mt-2 inline-block text-emerald-400 hover:underline">
              back to feed
            </Link>
          </div>
        ) : error ? (
          <div className="p-4 font-mono text-xs text-slate-400">
            <p>{error}</p>
            <Link href="/" className="mt-2 inline-block text-emerald-400 hover:underline">
              back to feed
            </Link>
          </div>
        ) : fetching ? (
          <div className="p-4 font-mono text-xs text-slate-500">loading article…</div>
        ) : post ? (
          <PostDetail post={post} />
        ) : (
          <div className="p-4 font-mono text-xs text-slate-500">loading article…</div>
        )}
      </div>
    </div>
  );
}