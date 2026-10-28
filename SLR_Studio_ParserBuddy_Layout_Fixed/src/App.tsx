import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { FastForward, Pause, Play, SkipBack, StepBack, StepForward } from "lucide-react";
import GrammarInput from "./components/GrammarInput";
import StageContent, { StageTabs } from "./components/Stages";
import ExplanationPanel from "./components/ExplanationPanel";
// The chat drawer pulls in a Markdown renderer, so it is fetched the first time it is opened.
const ChatbotDrawer = lazy(() => import("./components/ChatbotDrawer"));
import ErrorBoundary from "./components/ErrorBoundary";
import { DEFAULT_GRAMMAR, DEFAULT_INPUT, generateParser } from "./parser";
import { buildShareUrl, decodeShareState, encodeShareState } from "./shareLink";
import { useStudioStore } from "./store";
import { useChatStore } from "./store/useChatStore";
import type { ParserResult } from "./types";

const speedLabels = ["0.5×", "0.75×", "1×", "1.5×", "2×"];
const speedIntervals = [1800, 1300, 950, 650, 400];

// A shared link fills in the boxes. Anything malformed falls back to the defaults with a message,
// so a bad link can never blank the page.
function loadInitial(): { grammar: string; input: string; characterMode: boolean; result: ParserResult; error: string } {
  const shared = typeof window === "undefined" ? null : decodeShareState(window.location.hash);
  if (!shared) {
    return { grammar: DEFAULT_GRAMMAR, input: DEFAULT_INPUT, characterMode: false, result: generateParser(DEFAULT_GRAMMAR, DEFAULT_INPUT), error: "" };
  }
  try {
    return { ...shared, result: generateParser(shared.grammar, shared.input, { characterMode: shared.characterMode }), error: "" };
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "it could not be parsed.";
    return { ...shared, result: generateParser(DEFAULT_GRAMMAR, DEFAULT_INPUT), error: `The shared link could not be loaded: ${detail}` };
  }
}

export default function App() {
  const [initial] = useState(loadInitial);
  const [grammar, setGrammar] = useState(initial.grammar);
  const [input, setInput] = useState(initial.input);
  const [characterMode, setCharacterMode] = useState(initial.characterMode);
  const [error, setError] = useState(initial.error);
  const [result, setResult] = useState<ParserResult>(initial.result);
  const [linkCopied, setLinkCopied] = useState(false);
  const stage = useStudioStore((state) => state.stage);
  const activeStep = useStudioStore((state) => state.activeStep);
  const playing = useStudioStore((state) => state.playing);
  const speed = useStudioStore((state) => state.speed);
  const explanation = useStudioStore((state) => state.explanation);
  const setStage = useStudioStore((state) => state.setStage);
  const setStep = useStudioStore((state) => state.setStep);
  const setPlaying = useStudioStore((state) => state.setPlaying);
  const setSpeed = useStudioStore((state) => state.setSpeed);
  const explain = useStudioStore((state) => state.explain);
  const closeExplanation = useStudioStore((state) => state.closeExplanation);
  const resetStore = useStudioStore((state) => state.reset);
  const openChatWithContext = useChatStore((state) => state.openChatWithContext);
  const chatLoaded = useChatStore((state) => state.hasOpened);
  const finalStep = result.trace.length - 1;

  const askAIAboutExplanation = () => {
    if (!explanation) return;
    closeExplanation();
    openChatWithContext(
      `The learner is using this grammar:\n${grammar}\n\nInput string: ${input || "(empty)"}\nCurrent parser stage: ${stage}\nCurrent trace step: ${activeStep}\n\nSelected explanation: ${explanation.title}\n${explanation.body}`,
      `Can you explain ${explanation.title} in the context of my grammar?`,
    );
  };

  // Pasting a shared link into the address bar of a tab that is already open only changes the #hash,
  // so the page is not reloaded. (replaceState in generate() does not fire this event.)
  useEffect(() => {
    const onHashChange = () => {
      const shared = decodeShareState(window.location.hash);
      if (!shared) return;
      setGrammar(shared.grammar);
      setInput(shared.input);
      setCharacterMode(shared.characterMode);
      setPlaying(false);
      try {
        setResult(generateParser(shared.grammar, shared.input, { characterMode: shared.characterMode }));
        setStep(0);
        setError("");
        closeExplanation();
      } catch (reason) {
        setError(`The shared link could not be loaded: ${reason instanceof Error ? reason.message : "it could not be parsed."}`);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [setPlaying, setStep, closeExplanation]);

  const generate = () => {
    setPlaying(false);
    try {
      const nextResult = generateParser(grammar, input, { characterMode });
      setResult(nextResult);
      window.history.replaceState(null, "", `#${encodeShareState({ grammar, input, characterMode })}`);
      setStep(0);
      setError("");
      closeExplanation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The grammar could not be parsed. Check the production syntax and try again.");
    }
  };

  const reset = () => {
    setGrammar(DEFAULT_GRAMMAR);
    setInput(DEFAULT_INPUT);
    setCharacterMode(false);
    setError("");
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setResult(generateParser(DEFAULT_GRAMMAR, DEFAULT_INPUT));
    resetStore();
  };

  const copyLink = async () => {
    const url = buildShareUrl({ grammar, input, characterMode }, window.location.href);
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
    } catch {
      window.prompt("Copy this link", url); // clipboard access is blocked on insecure pages
    }
  };

  useEffect(() => {
    if (!linkCopied) return;
    const timer = window.setTimeout(() => setLinkCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [linkCopied]);

  const moveTo = useCallback((step: number) => setStep(Math.max(0, Math.min(finalStep, step))), [finalStep, setStep]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const current = useStudioStore.getState().activeStep;
      if (current >= finalStep) {
        setPlaying(false);
        return;
      }
      setStep(current + 1);
    }, speedIntervals[speed]);
    return () => window.clearInterval(timer);
  }, [playing, speed, finalStep, setPlaying, setStep]);

  useEffect(() => {
    if (activeStep >= finalStep && playing) setPlaying(false);
  }, [activeStep, finalStep, playing, setPlaying]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Leave browser and OS shortcuts alone (for example Alt+← is "Back").
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (useChatStore.getState().isOpen) return; // the chat is a modal dialog: Space and arrows belong to it
      const state = useStudioStore.getState();
      if (event.code === "Escape" && state.explanation) {
        closeExplanation();
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      // Text fields, selects, and range sliders use these keys themselves.
      if (target?.closest("input, textarea, select") || target?.isContentEditable) return;
      if (event.code === "Space") {
        // Space already activates a focused button or link; handling it here too would toggle twice.
        if (target?.closest("button, a")) return;
        event.preventDefault();
        setPlaying(!state.playing);
      }
      if (event.code === "ArrowRight") moveTo(state.activeStep + 1);
      if (event.code === "ArrowLeft") moveTo(state.activeStep - 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveTo, setPlaying, closeExplanation]);

  return (
    <div className="app-shell">
      <GrammarInput grammar={grammar} input={input} error={error} warnings={result.grammar.warnings} characterMode={characterMode} linkCopied={linkCopied} onGrammarChange={setGrammar} onInputChange={setInput} onCharacterModeChange={setCharacterMode} onGenerate={generate} onReset={reset} onCopyLink={copyLink} onAskAI={() => openChatWithContext(`The learner is using this grammar:\n${grammar}\n\nInput string: ${input || "(empty)"}\nCurrent parser stage: ${stage}\nCurrent trace step: ${activeStep}`)} />
      <main className="workspace">
        <StageTabs stage={stage} setStage={setStage} />
        <ErrorBoundary resetKey={`${stage}|${activeStep}|${result.trace.length}`}>
          <AnimatePresence mode="wait">
            <StageContent result={result} stage={stage} activeStep={activeStep} explain={explain} setStep={setStep} />
          </AnimatePresence>
        </ErrorBoundary>
      </main>
      <footer className="transport-bar">
        <div className="transport-inner">
          <div className="transport-brand"><span className="transport-pulse" /> <span>ANIMATION CONTROLS</span></div>
          <div className="transport-buttons">
            <button type="button" className="transport-button" aria-label="Skip back" title="Skip back" onClick={() => moveTo(0)}><SkipBack size={17} /></button>
            <button type="button" className="transport-button" aria-label="Step back" title="Step back" onClick={() => { setPlaying(false); moveTo(activeStep - 1); }}><StepBack size={17} /></button>
            <button type="button" className="transport-button play-button" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} onClick={() => {
              if (!playing && activeStep >= finalStep) moveTo(0);
              setPlaying(!playing);
            }}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
            <button type="button" className="transport-button" aria-label="Step forward" title="Step forward" onClick={() => { setPlaying(false); moveTo(activeStep + 1); }}><StepForward size={17} /></button>
            <button type="button" className="transport-button" aria-label="Skip forward" title="Skip forward" onClick={() => { setPlaying(false); moveTo(finalStep); }}><FastForward size={17} /></button>
          </div>
          <div className="transport-progress"><span>{String(activeStep).padStart(2, "0")}</span><input type="range" min={0} max={finalStep} value={activeStep} onChange={(event) => { setPlaying(false); moveTo(Number(event.target.value)); }} aria-label="Parsing step" /><span>{String(finalStep).padStart(2, "0")}</span></div>
          <div className="speed-control"><span>SPEED</span><input type="range" min={0} max={4} step={1} value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="Animation speed" /><span className="speed-value">{speedLabels[speed]}</span></div>
          <div className="keyboard-hint"><kbd>←</kbd><kbd>→</kbd><span>to step</span><span className="keyboard-separator">·</span><kbd>space</kbd><span>play</span></div>
        </div>
      </footer>
      <ExplanationPanel explanation={explanation} onClose={closeExplanation} onAskAI={askAIAboutExplanation} />
      {chatLoaded && (
        <Suspense fallback={null}>
          <ChatbotDrawer />
        </Suspense>
      )}
    </div>
  );
}
