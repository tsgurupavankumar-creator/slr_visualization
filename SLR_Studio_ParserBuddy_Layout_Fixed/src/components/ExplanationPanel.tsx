import { AnimatePresence, motion } from "framer-motion";
import { Bot, Lightbulb, MessageCircle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { Explanation } from "../types";

function proofText(text: string): ReactNode[] {
  return text.split(/(\*\*.+?\*\*(?!\*)|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

export default function ExplanationPanel({ explanation, onClose, onAskAI }: {
  explanation: Explanation | null;
  onClose: () => void;
  onAskAI?: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const isOpen = explanation !== null;

  // aria-modal promises a dialog: focus moves into it, Tab stays inside, and focus returns on close.
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, [isOpen]);

  const trapTab = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <AnimatePresence>
      {explanation && (
        <>
          <motion.button className="drawer-scrim" type="button" aria-label="Close explanation" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div className="explanation-drawer" role="dialog" aria-modal="true" aria-label="Parser explanation" onKeyDown={trapTab} initial={{ x: 420 }} animate={{ x: 0 }} exit={{ x: 420 }} transition={{ type: "spring", damping: 30, stiffness: 300 }}>
            <div className="drawer-head"><div className="bot-avatar"><Bot size={19} /></div><div><strong>Parsing buddy</strong><span>Here to make the details click</span></div><button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
            <div className="drawer-body">
              <span className="explanation-label"><Lightbulb size={14} /> {explanation.trace ? "STEP-BY-STEP PARSER TRACE" : explanation.derivation ? "CALCULATED FROM YOUR GRAMMAR" : "PARSER EXPLANATION"}</span>
              <h2>{explanation.title}</h2>
              {explanation.body && <p>{proofText(explanation.body)}</p>}
              {explanation.trace && (
                <section className="trace-guide" aria-label="Trace this step">
                  <div className="trace-guide-title"><span>Trace this step</span><span>STEP {String(explanation.trace.step).padStart(2, "0")}</span></div>
                  <div className="trace-focus">
                    <span className="trace-focus-label">STACK BEFORE ACTION</span>
                    <code>{explanation.trace.stack.join("   ") || "I0"}</code>
                  </div>
                  <div className="trace-focus">
                    <span className="trace-focus-label">INPUT BEFORE ACTION · LOOKAHEAD FIRST</span>
                    <code>{explanation.trace.input.join(" ") || "$"}</code>
                  </div>
                  <div className="trace-focus trace-table-focus">
                    <span className="trace-focus-label">TABLE CELL USED</span>
                    <code>{explanation.trace.tableCell}</code>
                    <strong>{explanation.trace.action}</strong>
                  </div>
                  <div className="trace-focus">
                    <span className="trace-focus-label">STACK AFTER ACTION</span>
                    <code>{explanation.trace.resultingStack.join("   ") || "I0"}</code>
                  </div>
                  <div className="trace-focus">
                    <span className="trace-focus-label">INPUT AFTER ACTION</span>
                    <code>{explanation.trace.resultingInput.join(" ") || "$"}</code>
                  </div>
                  <p>The live stack and input buffer show the result; compare them with the before-action values and table cell above.</p>
                </section>
              )}
              {explanation.derivation && (
                <div className="explanation-proof">
                  <ul>
                    {explanation.derivation.steps.map((step, index) => (
                      <li key={`${step.productionId ?? "start"}-${step.position ?? "rule"}-${index}`}>
                        <span className="proof-rule">{step.rule}</span>
                        <p>{proofText(step.explanation)}</p>
                      </li>
                    ))}
                  </ul>
                  <div className="proof-result"><span>Therefore</span><strong>{proofText(explanation.derivation.result)}</strong></div>
                </div>
              )}
              <div className="drawer-tip"><span>✦</span><p>Each step uses the grammar you entered. Click another rule, state item, table cell, or trace row whenever you’re ready.</p></div>
              {onAskAI && (
                <button className="button button-primary explanation-ask-ai" type="button" onClick={onAskAI}>
                  <MessageCircle size={15} /> Ask ParserBuddy about this
                </button>
              )}
            </div>
            <div className="drawer-footer">SLR studio <span>·</span> learn at your own pace</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
