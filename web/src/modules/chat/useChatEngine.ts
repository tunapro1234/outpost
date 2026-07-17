import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  makeChatStore,
  newThread,
  streamChat,
  threadTitle,
  type ChatMessage,
  type ChatStore,
  type ChatThread,
} from "@/core/chat";

export interface UseChatEngineOptions {
  // Workspace-relative endpoint, e.g. "assistant" | "mailagent".
  endpoint: string;
  // Persistence namespace, e.g. "assistant" | "mailcal".
  ns: string;
  // Human title, used only in the fallback error message.
  title: string;
  // Optional auto-send (from a prompt bar). Cleared by the caller via onSeedConsumed.
  seed?: string | null;
  onSeedConsumed?: () => void;
  // Fired when a reply finishes streaming.
  onReplyComplete?: (threadId?: string) => void;
}

// The shared conversation engine behind every chat surface (the right-rail
// Assistant drawer and the in-page mail-calibration panel). It owns the thread
// list, per-thread SSE streaming, local persistence and the scroll refs; the
// surfaces only render its state and wire its handlers to their own chrome.
export function useChatEngine({
  endpoint,
  ns,
  title,
  seed,
  onSeedConsumed,
  onReplyComplete,
}: UseChatEngineOptions) {
  // A fresh store per namespace; memoized so the load functions stay stable.
  const store: ChatStore = useMemo(() => makeChatStore(ns), [ns]);

  // Load the persisted thread list once; guarantee an active thread to type in.
  const initial = useMemo(() => {
    const s = store.load();
    const activeOk = s.activeId && s.threads.some((t) => t.id === s.activeId);
    if (s.threads.length === 0 || !activeOk) {
      const t = newThread();
      return { threads: [t, ...s.threads], activeId: t.id };
    }
    return { threads: s.threads, activeId: s.activeId as string };
  }, [store]);

  const [threads, setThreads] = useState<ChatThread[]>(initial.threads);
  const [activeId, setActiveId] = useState<string>(initial.activeId);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  // The active thread drives what the body renders and where sends append.
  const active = threads.find((t) => t.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  // Refs so the streaming callbacks always target the current active thread.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const backendIdRef = useRef<string | null>(active?.backendThreadId ?? null);
  backendIdRef.current = active?.backendThreadId ?? null;

  const updateActiveMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== activeIdRef.current) return t;
          const next = updater(t.messages);
          return {
            ...t,
            messages: next,
            title: threadTitle(next),
            updatedAt: Date.now(),
          };
        })
      );
    },
    []
  );

  // Persist the whole thread list (errors stripped inside store.save).
  useEffect(() => store.save({ threads, activeId }), [store, threads, activeId]);

  // Terminate any in-flight SSE fetch on unmount.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    []
  );

  // Keep pinned to the newest content while the user hasn't scrolled up.
  useLayoutEffect(() => {
    if (stickToBottom.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages]);

  const onBodyScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      stickToBottom.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      setHistoryOpen(false);
      setStreaming(true);
      setInput("");
      updateActiveMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        { role: "assistant", content: "" },
      ]);

      const appendToAssistant = (delta: string) =>
        updateActiveMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "assistant") {
              next[i] = { ...next[i], content: next[i].content + delta };
              break;
            }
          }
          return next;
        });

      const streamThreadId = activeIdRef.current;
      const setBackendId = (tid: string) =>
        setThreads((prev) =>
          prev.map((t) =>
            t.id === streamThreadId ? { ...t, backendThreadId: tid } : t
          )
        );

      streamChat(endpoint, trimmed, backendIdRef.current, controller.signal, {
        onDelta: appendToAssistant,
        onError: (msg) =>
          updateActiveMessages((prev) => [
            ...prev,
            { role: "error", content: msg },
          ]),
        onDone: (tid) => {
          if (tid) setBackendId(tid);
          setStreaming(false);
          abortRef.current = null;
          updateActiveMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && !last.content)
              return prev.slice(0, -1);
            return prev;
          });
          onReplyComplete?.(tid);
        },
      }).catch((err) => {
        setStreaming(false);
        abortRef.current = null;
        if ((err as Error)?.name === "AbortError") {
          updateActiveMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant" && !last.content)
              return next.slice(0, -1);
            return next;
          });
          return;
        }
        updateActiveMessages((prev) => [
          ...prev,
          {
            role: "error",
            content: `Connection to ${title.toLowerCase()} failed.`,
          },
        ]);
      });
    },
    [streaming, endpoint, title, onReplyComplete, updateActiveMessages]
  );

  // Auto-dispatch a seeded message. Runs only on seed changes.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (seed && seed.trim()) {
      sendRef.current(seed);
      onSeedConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setHistoryOpen(false);
    if (active && active.messages.length === 0) {
      inputRef.current?.focus();
      return;
    }
    const t = newThread();
    setThreads((prev) => [t, ...prev]);
    setActiveId(t.id);
    inputRef.current?.focus();
  }, [active]);

  const openThread = useCallback(
    (id: string) => {
      if (id === activeId) {
        setHistoryOpen(false);
        return;
      }
      abortRef.current?.abort();
      abortRef.current = null;
      setStreaming(false);
      setActiveId(id);
      setHistoryOpen(false);
      setThreads((prev) =>
        prev.filter((t) => t.messages.length > 0 || t.id === id)
      );
      inputRef.current?.focus();
    },
    [activeId]
  );

  const deleteThread = useCallback(
    (id: string) => {
      const remaining = threads.filter((t) => t.id !== id);
      if (id !== activeId) {
        setThreads(remaining);
        return;
      }
      abortRef.current?.abort();
      abortRef.current = null;
      setStreaming(false);
      const nextActive = [...remaining]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .find((t) => t.messages.length > 0);
      if (nextActive) {
        setThreads(remaining);
        setActiveId(nextActive.id);
      } else {
        const t = newThread();
        setThreads([t, ...remaining]);
        setActiveId(t.id);
      }
    },
    [threads, activeId]
  );

  // History list: only threads with content, newest first.
  const history = useMemo(
    () =>
      threads
        .filter((t) => t.messages.length > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [threads]
  );

  return {
    store,
    threads,
    activeId,
    active,
    messages,
    input,
    setInput,
    streaming,
    historyOpen,
    setHistoryOpen,
    send,
    stop,
    newChat,
    openThread,
    deleteThread,
    history,
    empty: messages.length === 0,
    bodyRef,
    inputRef,
    onBodyScroll,
  };
}
