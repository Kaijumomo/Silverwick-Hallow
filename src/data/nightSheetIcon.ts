/** The official night-sheet icons for the steps that are not characters (design: public/nightsheet). */
export const NIGHT_SHEET_STEP_IDS = ["dusk", "minioninfo", "demoninfo", "dawn"] as const;
export type NightSheetStepId = (typeof NIGHT_SHEET_STEP_IDS)[number];

export const nightSheetIconUrl = (id: NightSheetStepId): string => `/nightsheet/${id}.png`;

/** The night-sheet step a Storyteller night step stands for, when it has one. */
export function nightSheetIdOfStep(stepKey: string): NightSheetStepId | undefined {
  return stepKey === "minionInfo" ? "minioninfo" : stepKey === "demonInfo" ? "demoninfo" : undefined;
}
