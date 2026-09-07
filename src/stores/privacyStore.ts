import { create } from "zustand";

/**
 * Storyteller-only presentation state. This store is intentionally not
 * persisted, serialized into game state, or connected to Firebase.
 */
type PrivacyState = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
  reset: () => void;
};

export const usePrivacyStore = create<PrivacyState>((set) => ({
  enabled: false,
  setEnabled: (enabled) => set({ enabled }),
  toggle: () => set((state) => ({ enabled: !state.enabled })),
  reset: () => set({ enabled: false }),
}));

