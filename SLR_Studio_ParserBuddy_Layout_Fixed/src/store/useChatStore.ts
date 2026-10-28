import { create } from "zustand";
import { askGroq, isAbortError } from "../services/groqService";
import type { ChatTurn } from "../services/groqService";

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

export type ChatSession = { id: string; title: string; messages: ChatMessage[]; updatedAt: number };

type ChatState = {
  sessions: ChatSession[];
  activeSessionId: string;
  newChat: () => void;
  selectChat: (id: string) => void;
  deleteChat: (id: string) => void;
  isOpen: boolean;
  /** True once the drawer has been opened; lets the app load the chat code lazily and keep it for exit animations. */
  hasOpened: boolean;
  messages: ChatMessage[];
  isLoading: boolean;
  context: string;
  error: string | null;
  openChat: () => void;
  openChatWithContext: (newContext: string, initialQuestion?: string) => void;
  closeChat: () => void;
  clearChat: () => void;
  sendMessage: (prompt: string) => Promise<void>;
};

// A long session must not grow without bound (only the last turns are ever sent to the model anyway).
const MAX_STORED_MESSAGES = 100;

const STORAGE_KEY = "parserbuddy-conversations-v1";
const MAX_SESSIONS = 20;
const storageAvailable = () => typeof localStorage !== "undefined";
const createSession = (): ChatSession => ({
  id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  title: "New conversation",
  messages: [],
  updatedAt: Date.now(),
});
function loadSessions(): { sessions: ChatSession[]; activeSessionId: string } {
  try {
    const raw = storageAvailable() ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && "sessions" in parsed && Array.isArray(parsed.sessions)) {
        const sessions: ChatSession[] = parsed.sessions.slice(0, MAX_SESSIONS).filter((entry: unknown): entry is ChatSession => {
          if (!entry || typeof entry !== "object") return false;
          const item = entry as Partial<ChatSession>;
          return typeof item.id === "string" && typeof item.title === "string" &&
            typeof item.updatedAt === "number" && Array.isArray(item.messages) &&
            item.messages.length <= MAX_STORED_MESSAGES && item.messages.every(m =>
              typeof m.id === "number" && (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string" && m.content.length <= 30000);
        });
        if (sessions.length) {
          const id = "activeSessionId" in parsed && typeof parsed.activeSessionId === "string" ? parsed.activeSessionId : sessions[0].id;
          return { sessions, activeSessionId: sessions.some(t => t.id === id) ? id : sessions[0].id };
        }
      }
    }
  } catch { /* Private browsing or damaged storage: start fresh */ }
  const first = createSession();
  return { sessions: [first], activeSessionId: first.id };
}
const initial = loadSessions();
let messageId = Math.max(0, ...initial.sessions.flatMap(c => c.messages.map(m => m.id)));
function cancelPending() {
  activeRequest += 1;
  inFlight?.abort();
  inFlight = null;
}
function persist() {
  try {
    if (!storageAvailable()) return;
    const state = useChatStore.getState();
    const snapshot = state.sessions.map(session => session.id === state.activeSessionId
      ? { ...session, messages: state.messages,
          title: state.messages.find(m => m.role === "user")?.content.slice(0, 55) || session.title }
      : session);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions: snapshot, activeSessionId: state.activeSessionId }));
  } catch { /* Storage full or disabled: chatting still works in memory */ }
}

let activeRequest = 0;
let inFlight: AbortController | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  hasOpened: false,
  messages: initial.sessions.find(c => c.id === initial.activeSessionId)?.messages ?? [],
  sessions: initial.sessions,
  activeSessionId: initial.activeSessionId,
  newChat: () => {
    cancelPending();
    const session = createSession();
    set(state => ({ sessions: [session, ...state.sessions].slice(0, MAX_SESSIONS), activeSessionId: session.id, messages: [], context: "", error: null, isLoading: false }));
  },
  selectChat: (id) => {
    const session = get().sessions.find(c => c.id === id);
    if (!session) return;
    cancelPending();
    set({ activeSessionId: id, messages: session.messages, isLoading: false, error: null, context: "" });
  },
  deleteChat: (id) => {
    cancelPending();
    const remaining = get().sessions.filter(c => c.id !== id);
    if (!remaining.length) remaining.push(createSession());
    const selected = id === get().activeSessionId ? remaining[0] : remaining.find(c => c.id === get().activeSessionId) ?? remaining[0];
    set({ sessions: remaining, activeSessionId: selected.id, messages: selected.messages, isLoading: false, error: null, context: "" });
  },
  isLoading: false,
  context: "",
  error: null,
  openChat: () => set({ isOpen: true, hasOpened: true }),
  openChatWithContext: (context, initialQuestion) => {
    set({ isOpen: true, hasOpened: true, context, error: null });
    if (initialQuestion?.trim()) void get().sendMessage(initialQuestion);
  },
  closeChat: () => set({ isOpen: false }),
  clearChat: () => {
    activeRequest += 1;
    inFlight?.abort(); // stop the network request and the stream, not just ignore the result
    inFlight = null;
    set({ messages: [], isLoading: false, error: null });
  },
  sendMessage: async (prompt) => {
    const content = prompt.trim();
    if (!content || get().isLoading) return;

    const requestId = ++activeRequest;
    const controller = new AbortController();
    inFlight = controller;
    const current = () => requestId === activeRequest;

    // The model gets the conversation so far, so follow-up questions make sense.
    const history: ChatTurn[] = get().messages.map(({ role, content: text }) => ({ role, content: text }));
    const userMessage: ChatMessage = { id: ++messageId, role: "user", content };
    const context = get().context;
    set((state) => ({
      messages: [...state.messages, userMessage].slice(-MAX_STORED_MESSAGES),
      isLoading: true,
      error: null,
    }));

    // The assistant bubble appears when the API response arrives (or incrementally if streaming is enabled).
    let assistantId: number | null = null;
    let streamed = "";
    const show = (text: string) => {
      if (assistantId === null) {
        assistantId = ++messageId;
        const created: ChatMessage = { id: assistantId, role: "assistant", content: text };
        set((state) => ({ messages: [...state.messages, created].slice(-MAX_STORED_MESSAGES) }));
      } else {
        const id = assistantId;
        set((state) => ({ messages: state.messages.map((message) => (message.id === id ? { ...message, content: text } : message)) }));
      }
    };

    try {
      const response = await askGroq(content, context, {
        history,
        signal: controller.signal,
        onText: (delta) => {
          if (!current()) return;
          streamed += delta;
          show(streamed);
        },
      });
      if (current()) show(response); // the final text can add a note, e.g. when the answer was cut short
    } catch (reason) {
      if (current() && !isAbortError(reason)) {
        set({ error: reason instanceof Error ? reason.message : "The tutor could not respond. Please try again." });
      }
    } finally {
      if (current()) {
        inFlight = null;
        set({ isLoading: false });
      }
    }
  },
}));

// Persist only completed store updates; keep requests and API keys out of storage.
useChatStore.subscribe((state, previous) => {
  if (state.messages !== previous.messages || state.sessions !== previous.sessions || state.activeSessionId !== previous.activeSessionId) {
    const active = state.sessions.find(c => c.id === state.activeSessionId);
    if (active && active.messages !== state.messages) {
      useChatStore.setState({ sessions: state.sessions.map(c => c.id === state.activeSessionId
        ? { ...c, messages: state.messages, title: state.messages.find(m => m.role === "user")?.content.slice(0, 55) || c.title, updatedAt: Date.now() }
        : c) });
    } else persist();
  }
});
