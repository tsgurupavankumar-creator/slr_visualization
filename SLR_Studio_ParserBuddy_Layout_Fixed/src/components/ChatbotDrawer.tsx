import { AnimatePresence, motion } from "framer-motion";
import { Bot, MessageCircle, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import { LIMITS } from "../services/groqService";
import { useChatStore } from "../store/useChatStore";

// The model's reply is untrusted: a grammar from a shared link can try to steer it. Raw HTML is
// dropped, and images and links are not rendered at all, so a reply cannot load a remote image
// (a way to leak data) or present a clickable phishing link. Their text is still shown.
const MARKDOWN_BLOCKED = ["img", "a"];

export default function ChatbotDrawer() {
  const isOpen = useChatStore((state) => state.isOpen);
  const messages = useChatStore((state) => state.messages);
  const isLoading = useChatStore((state) => state.isLoading);
  const error = useChatStore((state) => state.error);
  const closeChat = useChatStore((state) => state.closeChat);
  const clearChat = useChatStore((state) => state.clearChat);
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const newChat = useChatStore((state) => state.newChat);
  const selectChat = useChatStore((state) => state.selectChat);
  const deleteChat = useChatStore((state) => state.deleteChat);
  const [showHistory, setShowHistory] = useState(false);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // The typing dots are for the wait before the first word; after that the growing answer is the signal.
  const waitingForFirstWord = isLoading && messages[messages.length - 1]?.role !== "assistant";

  // aria-modal promises a dialog: focus moves in, Tab stays inside, and focus returns on close.
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => opener?.focus();
  }, [isOpen]);

  useEffect(() => {
    // Smooth scrolling on every streamed word would stutter, so only animate between turns.
    messagesEndRef.current?.scrollIntoView({ behavior: isLoading ? "auto" : "smooth", block: "end" });
  }, [messages, isLoading]);

  const handleDialogKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeChat();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>("button, textarea, input, select, [href], [tabindex]:not([tabindex='-1'])")]
      .filter((element) => !element.hasAttribute("disabled"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const submitMessage = () => {
    const message = draft.trim();
    if (!message || isLoading) return;
    setDraft("");
    void sendMessage(message);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.button
            className="chatbot-scrim"
            type="button"
            aria-label="Close ParserBuddy"
            onClick={closeChat}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            className="chatbot-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="ParserBuddy chat"
            onKeyDown={handleDialogKeys}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <div className="chatbot-header">
              <div className="chatbot-header-top">
                <div className="chatbot-brand-icon"><Bot size={22} /></div>
                <div className="chatbot-heading">
                  <h2>ParserBuddy</h2>
                  <span><span className="chatbot-online-dot" /> Your AI parsing study companion</span>
                </div>
                <button className="chatbot-close" type="button" onClick={closeChat} aria-label="Close chat" title="Close chat">
                  <X size={19} />
                </button>
              </div>
              <div className="chatbot-header-actions">
                <button className="chatbot-header-action" type="button" onClick={newChat} aria-label="New chat" title="New chat">
                  <Plus size={16} /><span>New Chat</span>
                </button>
                <button className="chatbot-header-action" type="button" onClick={() => setShowHistory(!showHistory)} aria-label="Chat history" aria-expanded={showHistory}>
                  <MessageCircle size={16} /><span>History</span>
                </button>
                <button className="chatbot-header-action" type="button" onClick={clearChat} aria-label="Clear chat" title="Clear current chat">
                  <Trash2 size={16} /><span>Clear Chat</span>
                </button>
              </div>
            </div>

            {showHistory && <div className="parserbuddy-history" aria-label="Saved conversations">
              <div className="parserbuddy-history-heading">Saved on this browser · {sessions.length}/{20}</div>
              {sessions.map(session => <div className="parserbuddy-session" key={session.id}>
                <button type="button" className={session.id === activeSessionId ? "parserbuddy-session-select active" : "parserbuddy-session-select"}
                  onClick={() => { selectChat(session.id); setShowHistory(false); }}
                  title={session.title}>{session.title}</button>
                <button type="button" className="parserbuddy-session-delete" aria-label={`Delete conversation ${session.title}`}
                  onClick={() => deleteChat(session.id)}><Trash2 size={14}/></button>
              </div>)}
            </div>}
            <div className="chatbot-messages" role="log" aria-label="Chat messages" aria-busy={isLoading}>
              {messages.length === 0 && (
                <div className="chatbot-welcome">
                  <div className="chatbot-welcome-icon"><MessageCircle size={22} /></div>
                  <span className="chatbot-kicker">YOUR SLR STUDY BUDDY</span>
                  <h3>Parsing made clearer.</h3>
                  <p>Ask about grammars, FIRST and FOLLOW sets, states, parse tables, or any step in the trace.</p>
                  <p className="chatbot-privacy">Your question, your grammar, and the step you are viewing are sent to Groq to write each answer.</p>
                  <div className="chatbot-prompt-hint"><Sparkles size={14} /> Try: “What does this state mean?”</div>
                </div>
              )}
              {messages.map((message) => (
                <article key={message.id} className={`chat-message ${message.role === "user" ? "chat-message-user" : "chat-message-assistant"}`}>
                  {message.role === "assistant" && <div className="chat-message-avatar"><Bot size={15} /></div>}
                  <div className="chat-message-bubble">
                    {message.role === "assistant"
                      ? <ReactMarkdown skipHtml disallowedElements={MARKDOWN_BLOCKED} unwrapDisallowed>{message.content}</ReactMarkdown>
                      : message.content}
                  </div>
                </article>
              ))}
              {waitingForFirstWord && (
                <div className="chat-message chat-message-assistant" role="status" aria-label="ParserBuddy is typing">
                  <div className="chat-message-avatar"><Bot size={15} /></div>
                  <div className="chat-typing" aria-hidden="true"><span /><span /><span /></div>
                </div>
              )}
              {error && <p className="chatbot-error" role="alert">{error}</p>}
              <div ref={messagesEndRef} />
            </div>

            <div className="chatbot-composer">
              <div className="chatbot-input-wrap">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submitMessage();
                    }
                  }}
                  placeholder="Ask a question about SLR parsing..."
                  aria-label="Message ParserBuddy"
                  maxLength={LIMITS.prompt}
                  rows={1}
                />
                <button
                  className="chatbot-send"
                  type="button"
                  onClick={submitMessage}
                  disabled={!draft.trim() || isLoading}
                  aria-label="Send message"
                >
                  <Send size={17} />
                </button>
              </div>
              <p>Enter to send <span>·</span> Shift + Enter for a new line</p>
              <p className="chatbot-disclaimer">Answers come from an AI and can contain mistakes. Check them against the tables above.</p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
