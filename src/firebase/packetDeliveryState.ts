import { create } from "zustand";

// Ephemeral server acknowledgements, never trusted from localStorage.
export const usePacketDeliveryState = create<{
  receipts: Record<string, string>;
  queued: Record<string, boolean>;
}>(() => ({ receipts: {}, queued: {} }));
export const packetKey = (code: string, id: string) => `${code}/${id}`;

export function acknowledgePackets(code: string, packets: Record<string, string>) {
  usePacketDeliveryState.setState(state => ({
    receipts: {
      ...Object.fromEntries(Object.entries(state.receipts).filter(([key]) => !key.startsWith(code + "/"))),
      ...Object.fromEntries(Object.entries(packets).map(([id, receipt]) => [packetKey(code, id), receipt])),
    },
  }));
}
