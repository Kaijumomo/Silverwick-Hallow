import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { registersAsDemonJudgment } from "@/abilities/characters/slayer";
import { automationEligibility } from "@/abilities/automationEligibility";
import { iconUrlFor } from "@/data/iconUrl";
import { bindingOf, pathAbility, useTargetPicker } from "@/features/abilities/abilityUi";
import { captureFingerprint, planAbilityResolution, type AbilityResolutionRequest, type ParticipantBinding } from "@/stores/abilityResolution";
import { hasEffect } from "@/stores/effects";
import { createRulesQuery } from "@/stores/rulesQuery";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { wakeIdentity } from "@/stores/wakeIdentity";
import type { PlayerId, STPlayerRecord } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { flash } from "../v6Store";
import { useDayUi } from "./dayUi";

const RED = "#f4a595";
const DIM = "rgba(222,216,204,.45)";
const ON = "#ece6da";
const SLAYER_TEXT = "Once per game, during the day, publicly choose a player: if they are the Demon, they die.";

/** How a shot is decided: by the verified Slayer rules, by a Recluse ruling, or by the Storyteller alone. */
type Evaluation = {
  /** The shooter really is a living Slayer whose shot the engine can record. */
  real: boolean;
  used: boolean;
  /** What the rules say happens (before any override). */
  dies: boolean;
  why: string;
  /** "plan": engine outcome. "judgment": a Recluse-style ruling is pending. "manual": Silverwick cannot rule on it. "none": nothing to record. */
  kind: "plan" | "judgment" | "manual" | "none";
  judgmentId?: string;
};

const seated = (game: V6Ctx["game"]) => game.seatOrder.map((id) => game.players[id]).filter((p): p is STPlayerRecord => !!p && !p.isEmpty && !!p.participantId);

/** The living-or-dead player who holds the Slayer, if one is in play. */
export function slayerHolder(ctx: V6Ctx): STPlayerRecord | null {
  const all = seated(ctx.game).filter((p) => p.actualRole === "slayer");
  return all.find((p) => p.alive) ?? all[0] ?? null;
}

function slayerStatus(holder: STPlayerRecord | null): { status: string; color: string; unused: boolean } {
  if (!holder) return { status: "Not in play", color: "rgba(222,216,204,.5)", unused: false };
  if (!holder.alive) return { status: "Dead", color: "rgba(222,216,204,.5)", unused: false };
  if (holder.abilityUsed) return { status: "Used", color: "rgba(222,216,204,.5)", unused: false };
  if (hasEffect(holder, "poisoned")) return { status: "Poisoned", color: "#e7a35b", unused: false };
  if (hasEffect(holder, "drunk")) return { status: "Drunk", color: "#e7a35b", unused: false };
  return { status: "Unused", color: "#8fcf95", unused: true };
}

function request(ctx: V6Ctx, shooter: STPlayerRecord, target: STPlayerRecord, inputs: Record<string, unknown> = {}): { request: AbilityResolutionRequest; targetBinding: ParticipantBinding } | null {
  const fingerprint = captureFingerprint(ctx.game, shooter.id);
  if (!fingerprint || !target.participantId) return null;
  const targetBinding = bindingOf(target);
  return {
    targetBinding,
    request: { mode: "guided", invocationPath: "dayEntry", fingerprint, roleId: "slayer",
      inputs: { target: { kind: "participant", participants: [targetBinding] }, ...inputs } } as AbilityResolutionRequest,
  };
}

/** Plans the shot without committing anything: what the verified rules say would happen. */
function evaluate(ctx: V6Ctx, shooterId: PlayerId, targetId: PlayerId | undefined): Evaluation {
  const { game, registry, script } = ctx;
  const shooter = game.players[shooterId];
  const target = targetId ? game.players[targetId] : undefined;
  const none = (why: string, used = false): Evaluation => ({ real: false, used, dies: false, why, kind: "none" });
  if (!shooter || shooter.isEmpty) return none("");
  const wake = wakeIdentity(shooter, registry);
  const roleId = wake?.simulated ? wake.shownRoleId : shooter.actualRole;
  if (roleId !== "slayer") return none(`${shooter.name} is not the Slayer.`);
  if (!shooter.alive) return none(`${shooter.name} is dead.`);
  if (shooter.abilityUsed) return none("Ability already used.", true);
  if (!target || !script) return { real: true, used: false, dies: false, why: "", kind: "plan" };

  const ability = pathAbility("slayer", registry, CANONICAL_ABILITY_SEMANTICS, "dayEntry", game);
  const query = createRulesQuery(game, { script, registry, semantics: CANONICAL_ABILITY_SEMANTICS });
  const automated = ability.kind === "guided" && automationEligibility({ query, descriptor: ability.descriptor, actor: bindingOf(shooter), roleId, simulated: wake?.simulated }).kind === "automated";
  const manual = (why: string): Evaluation => ({ real: true, used: false, dies: false, why, kind: "manual" });
  if (!automated) return manual(ability.kind === "manual" ? ability.reason : "Silverwick cannot rule on this shot.");

  const built = request(ctx, shooter, target);
  if (!built) return none("");
  const plan = planAbilityResolution(game, built.request, { script, registry, semantics: CANONICAL_ABILITY_SEMANTICS });
  if (plan.ok) {
    if (!plan.changed) return { real: true, used: false, dies: false, why: `${target.name} is not the Demon.`, kind: "none" };
    const dies = plan.plan.outcome.operations.some((op) => op.domain === "life" && op.intents.some((i) => i.kind === "death" && i.target.playerId === target.id));
    const demon = registry.get(target.actualRole)?.type === "demon";
    return { real: true, used: false, dies, kind: "plan", why: dies ? `${target.name} is the Demon.` : demon ? "The shot has no effect. The Slayer’s ability is spent." : `${target.name} is not the Demon.` };
  }
  const judgmentId = registersAsDemonJudgment(target.participantId!);
  const recluse = plan.code === "needsInput" && plan.requirements?.length === 1 && plan.requirements[0]?.id === judgmentId;
  if (recluse) return { real: true, used: false, dies: false, kind: "judgment", judgmentId, why: `${target.name} may register as the Demon. Rule on it with the override.` };
  if (plan.code === "unsupported" || plan.code === "needsInput") return manual(`${plan.message} Rule on it yourself.`);
  return none(plan.message);
}

/** Opens the face-off (Slayer card) -- Day only, never in Privacy Mode. */
export function openSlayer(ctx: V6Ctx): void {
  if (ctx.game.phase !== "day") return;
  if (ctx.privacy) { flash("Show tokens to use a Day ability."); return; }
  ctx.voting?.close();
  useTargetPicker.getState().cancel();
  useStorytellerStore.getState().selectPlayer(null);
  ctx.ui.set({ slay: { stage: "shooter" }, card: false, popMode: "main", panel: ctx.ui.panel === "night" ? "night" : null });
}

/** A seat tap while the shot is being set up: first the shooter, then the target. */
export function slayerTap(ctx: V6Ctx, id: PlayerId): void {
  const sl = ctx.ui.slay;
  const p = ctx.game.players[id];
  if (!sl || !p || p.isEmpty) return;
  if (sl.stage === "shooter") {
    if (!p.alive) { flash("The dead may not use day abilities."); return; }
    ctx.ui.set({ slay: { stage: "target", shooter: id } });
    return;
  }
  if (id === sl.shooter) { ctx.ui.set({ slay: { stage: "shooter" } }); return; }
  ctx.ui.set({ slay: { ...sl, stage: "result", target: id, override: false } });
}

/** Commits the shot the Storyteller has ruled on (or only announces it, when the rules record nothing). */
function confirm(ctx: V6Ctx, ev: Evaluation, dies: boolean): void {
  const { game, script, ui } = ctx;
  const sl = ui.slay;
  const shooter = sl?.shooter ? game.players[sl.shooter] : undefined;
  const target = sl?.target ? game.players[sl.target] : undefined;
  if (!sl || !shooter || !target || shooter.isEmpty || target.isEmpty) return;
  const override = !!sl.override;
  const finish = () => {
    useDayUi.getState().addLog({ code: game.code, day: game.day, shooter: shooter.name, target: target.name, dies, real: ev.real });
    ui.set({ slay: null });
    flash(dies ? `${target.name} dies.` : "Nothing happens.");
  };
  // Nothing for the rules to record (a bluff, a spent or dead Slayer): announce it -- unless the Storyteller rules a death.
  if (ev.kind === "none" && !dies) { finish(); return; }
  if (!script) return;
  const store = useStorytellerStore.getState();
  const actionContext = captureCharacterActionContext();
  let result;
  if (ev.kind === "plan" && !override) {
    const built = request(ctx, shooter, target);
    if (!built) return;
    result = store.resolveAbility(built.request, CANONICAL_ABILITY_SEMANTICS, actionContext);
  } else if (ev.kind === "judgment" && ev.judgmentId) {
    const built = request(ctx, shooter, target, { [ev.judgmentId]: { kind: "boolean", value: dies } });
    if (!built) return;
    result = store.resolveAbility(built.request, CANONICAL_ABILITY_SEMANTICS, actionContext);
  } else {
    // The Storyteller's own ruling (an override, or a shot Silverwick cannot judge): recorded as a labelled manual outcome.
    const fingerprint = captureFingerprint(game, shooter.id);
    if (!fingerprint) return;
    const spends = ev.real && !ev.used;
    const intents = [...(spends ? [{ kind: "useAbility" as const, target: bindingOf(shooter) }] : []), ...(dies ? [{ kind: "death" as const, target: bindingOf(target) }] : [])];
    result = store.resolveAbility({ mode: "manual", fingerprint, roleId: "slayer", outcome: { operations: [{ domain: "life", intents }] },
      reason: override ? "Storyteller override of a Slayer shot" : "Storyteller ruling on a Slayer shot" }, CANONICAL_ABILITY_SEMANTICS, actionContext);
  }
  if (!result.ok) { flash(result.message); return; }
  finish();
}

/** The Slayer's row in the Day card and the shot's own face-off card. */
export function buildSlayer(ctx: V6Ctx): Record<string, unknown> {
  const { game, ui, registry } = ctx;
  const sl = ui.slay;
  const holder = slayerHolder(ctx);
  const { status, color, unused } = slayerStatus(holder);
  const slayerDef = registry.get("slayer");
  const imgOf = (id?: string) => iconUrlFor(id ? registry.get(id) ?? id : "slayer");
  const log = useDayUi.getState().log.filter((l) => l.code === game.code).map((l) => ({ who: `Day ${l.day} · ${l.shooter} → ${l.target}`, out: l.dies ? "Died" : "Nothing", color: l.dies ? RED : "rgba(222,216,204,.6)" }));
  const base = {
    img: imgOf("slayer"), ability: slayerDef?.ability ?? SLAYER_TEXT,
    toggle: () => (sl ? ui.set({ slay: null }) : openSlayer(ctx)),
    pillColor: sl ? "#ff7a68" : unused ? "rgba(222,216,204,.7)" : "rgba(222,216,204,.4)",
    dayOn: game.phase === "day", holderText: holder ? holder.name : "Any shot is a bluff", status, statusColor: color,
    rowFilter: unused ? "none" : "grayscale(.7) brightness(.8)", log, hasLog: log.length > 0,
    btnText: sl ? "Cancel shot" : "Take a shot", btnBg: sl ? "rgba(176,186,204,.2)" : "rgba(176,186,204,.1)",
  };
  if (!sl || game.phase !== "day") return { ...base, open: false };

  const shooter = sl.shooter ? game.players[sl.shooter] : undefined;
  const target = sl.target ? game.players[sl.target] : undefined;
  const ev = shooter ? evaluate(ctx, shooter.id, target?.id) : null;
  const roleName = (p?: STPlayerRecord) => (p?.actualRole ? registry.get(p.actualRole)?.name ?? "" : "");
  const dies = !!ev && (sl.override ? !ev.dies : ev.dies);
  const holderNote = !holder ? "No Slayer in play. Any shot is a bluff." : `${holder.name} is the Slayer${holder.abilityUsed ? " · ability used" : " · ability unused"}.`;
  const demonTarget = target && registry.get(target.actualRole)?.type === "demon";
  return {
    ...base, open: true, close: () => ui.set({ slay: null }), reShooter: () => ui.set({ slay: { stage: "shooter" } }),
    s1Img: imgOf(shooter?.actualRole || "slayer"), s1Role: shooter ? roleName(shooter) : "Tap a player", s1Op: shooter ? 1 : 0.45,
    s1Ring: sl.stage === "shooter" ? "#e8584a" : "rgba(176,186,204,.35)",
    s2Img: imgOf(target?.actualRole || "imp"), s2Role: target ? roleName(target) : shooter ? "Tap a player" : "", s2Op: target ? 1 : 0.3,
    s2Ring: sl.stage === "target" ? "#e88a7a" : demonTarget ? "#e88a7a" : "rgba(176,186,204,.35)",
    s1: shooter?.name ?? "Tap a player", s1Color: shooter ? ON : DIM, s1Border: sl.stage === "shooter" ? "#c0392e" : "rgba(176,186,204,.2)",
    s2: target?.name ?? (shooter ? "Tap a player" : "—"), s2Color: target ? ON : DIM, s2Border: sl.stage === "target" ? "#c0392e" : "rgba(176,186,204,.2)",
    note: ev && sl.stage === "result" ? ev.why : sl.stage === "shooter" ? `Who is shooting? ${holderNote}` : holderNote,
    noteColor: ev && !ev.real ? RED : "rgba(222,216,204,.6)",
    result: sl.stage === "result",
    resTitle: dies ? `${target?.name ?? ""} dies` : "Nothing happens", resColor: dies ? RED : "#e8584a",
    resSub: sl.override ? "Storyteller override." : ev?.real && !ev.used ? "The Slayer’s ability is now spent." : "Announce that nothing happens.",
    confirm: () => { if (ev) confirm(ctx, ev, dies); }, confirmText: dies ? "Confirm death" : "Confirm",
    override: () => ui.set({ slay: { ...sl, override: !sl.override } }),
    overrideText: sl.override ? "Undo override" : dies ? "They survive" : "They die",
  };
}

/** Test seam: the verified-rules reading of a shot, without opening the card. */
export const evaluateSlayerShot = evaluate;
