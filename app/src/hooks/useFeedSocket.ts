"use client";

import { useEffect, useRef } from "react";
import { useFeedStore } from "@/store/useFeedStore";
import { fetchLatest } from "@/lib/feedApi";
import type { PostDTO } from "@/lib/types";

interface SnapshotMsg {
  type: "snapshot";
  posts: PostDTO[];
}
interface PostMsg {
  type: "post";
  post: PostDTO;
}
interface UpdateMsg {
  type: "update";
  post: PostDTO;
}
type WsMessage = SnapshotMsg | PostMsg | UpdateMsg;

function isPostDTO(x: unknown): x is PostDTO {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.title === "string" &&
    typeof p.publishedAt === "string" &&
    Array.isArray(p.instruments) &&
    typeof p.votes === "object" &&
    p.votes !== null
  );
}

export function useFeedSocket(): void {
  const mounted = useRef(true);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const everOpenedRef = useRef(false);

  useEffect(() => {
    mounted.current = true;

    const url = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4181";

    const connect = () => {
      if (!mounted.current) return;
      useFeedStore.getState().setWsStatus("connecting");
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.onopen = () => {
        if (!mounted.current) return;
        retryRef.current = 0;
        useFeedStore.getState().setWsStatus("open");
        if (everOpenedRef.current) {
          fetchLatest().catch(() => {});
        }
        everOpenedRef.current = true;
      };

      ws.onmessage = (event: MessageEvent) => {
        if (!mounted.current) return;
        let msg: WsMessage;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const store = useFeedStore.getState();
        if (msg.type === "snapshot" && Array.isArray(msg.posts)) {
          store.mergeSnapshot(msg.posts.filter(isPostDTO));
        } else if (msg.type === "post" && isPostDTO(msg.post)) {
          store.upsertPost(msg.post, true);
        } else if (msg.type === "update" && isPostDTO(msg.post)) {
          store.upsertPost(msg.post, false);
        }
      };

      ws.onclose = () => {
        if (!mounted.current) return;
        useFeedStore.getState().setWsStatus("closed");
        const delay = Math.min(1000 * Math.pow(2, retryRef.current), 10000);
        retryRef.current = Math.min(retryRef.current + 1, 5);
        timerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      mounted.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (socketRef.current) {
        socketRef.current.onclose = null;
        socketRef.current.close();
        socketRef.current = null;
      }
      useFeedStore.getState().setWsStatus("closed");
    };
  }, []);
}