/// <reference lib="webworker" />
/** Runs skyCanvas.ts's SkyPainter off the page, on a canvas handed over by boardArt.tsx SkyCanvas. */
import { SkyPainter } from "./skyCanvas";

export type SkyMessage =
  | { type: "start"; canvas: OffscreenCanvas; night: boolean; calm: boolean; w: number; h: number; dpr: number; image: string }
  | { type: "size"; w: number; h: number; dpr: number }
  | { type: "night"; night: boolean }
  | { type: "paused"; paused: boolean }
  | { type: "stop" };

let painter: SkyPainter | null = null;

self.onmessage = async (event: MessageEvent<SkyMessage>) => {
  const message = event.data;
  if (message.type === "start") {
    painter = new SkyPainter(message.canvas, message.night, message.calm);
    painter.setSize(message.w, message.h, message.dpr);
    painter.run();
    const blob = await (await fetch(message.image)).blob();
    painter?.setArt({ image: await createImageBitmap(blob) });
  } else if (message.type === "size") painter?.setSize(message.w, message.h, message.dpr);
  else if (message.type === "night") painter?.setNight(message.night);
  else if (message.type === "paused") painter?.setPaused(message.paused);
  else { painter?.stop(); painter = null; self.close(); }
};
