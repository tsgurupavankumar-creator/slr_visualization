import { create } from "zustand";
import type { Explanation, SetDerivation } from "./types";

export type StageId = "grammar" | "sets" | "states" | "table" | "trace";

type StudioState = {
  stage: StageId;
  activeStep: number;
  playing: boolean;
  speed: number;
  explanation: Explanation | null;
  setStage: (stage: StageId) => void;
  setStep: (step: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  explain: (title: string, body: string, derivation?: SetDerivation, trace?: Explanation["trace"]) => void;
  closeExplanation: () => void;
  reset: () => void;
};

export const useStudioStore = create<StudioState>((set) => ({
  stage: "grammar",
  activeStep: 0,
  playing: false,
  speed: 2,
  explanation: null,
  setStage: (stage) => set({ stage }),
  setStep: (activeStep) => set({ activeStep }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  explain: (title, body, derivation, trace) => set({ explanation: { title, body, derivation, trace } }),
  closeExplanation: () => set({ explanation: null }),
  reset: () => set({ stage: "grammar", activeStep: 0, playing: false, explanation: null }),
}));
