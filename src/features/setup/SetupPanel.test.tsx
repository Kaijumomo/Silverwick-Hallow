import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupPanel } from "./SetupPanel";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { makeSTPlayer } from "@/test/fixtures";
import { SETUP_COUNTS } from "@/data/setupCounts";
import { GameScreen } from "@/features/game/GameScreen";

function prepare(roles=standardRoles(5)) {
  const game=setupGame(roles,{rolePool:roles});
  Object.values(game.players).forEach(p=>{p.actualRole="";p.shownRole=null;});
  store.setState({game});
}
beforeEach(() => {
  usePrivacyStore.setState({enabled:false});
  store.setState({game:null,lobby:null,undoStack:[],customScripts:{[setupScript.id]:setupScript}});
  prepare();
  vi.stubGlobal("ResizeObserver",class {observe(){} disconnect(){}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
function Panel({foreground=false,onClose=()=>{}}:{foreground?:boolean;onClose?:()=>void}) {
  const game=store(s=>s.game)!;
  return <SetupPanel game={game} script={setupScript} onClose={onClose} foreground={foreground} />;
}
describe("Phase 9C storyteller setup", () => {
  it("offers one random deal, then an explicit Reveal, then a separate Begin Night 1", () => {
    render(<Panel/>);
    expect(screen.queryByLabelText("Assignment workflow")).toBeNull();
    expect(screen.queryByText(/Manual assignment|Random deal/i)).toBeNull();
    expect(screen.getByText(/Ready to deal/)).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"Deal roles"}));
    expect(store.getState().game).toMatchObject({phase:"setup",day:0,setupRolesDealt:true,setupRolesRevealed:false,rolePool:[]});
    expect(screen.queryByText("Role pool")).toBeNull();expect(screen.queryByRole("button",{name:"Edit roles"})).toBeNull();
    // Deal does not imply Reveal: Begin Night 1 is not yet offered.
    expect(screen.queryByRole("button",{name:"Begin Night 1"})).toBeNull();
    expect(screen.getByRole("button",{name:"Reveal Roles"})).toBeEnabled();
    fireEvent.click(screen.getByRole("button",{name:"Reveal Roles"}));
    expect(store.getState().game).toMatchObject({setupRolesRevealed:true,phase:"setup"});
    fireEvent.click(screen.getByRole("button",{name:"Begin Night 1"}));
    expect(store.getState().game).toMatchObject({phase:"night",day:1,startingNonTravelerCount:5});
  });
  it("does not offer manual assignment as an initial mode even with assigned roles", () => {
    store.setState({game:setupGame(standardRoles(5))});render(<Panel/>);
    expect(screen.getByRole("button",{name:"Choose roles"})).toBeVisible();
    expect(screen.queryByRole("button",{name:/Begin Night/})).toBeNull();
  });
  it("collapses missing-seat root causes into one action", () => {
    store.getState().newGame(setupScript.id,{plannedPlayerCount:7,plannedRoles:standardRoles(7)});
    const close=vi.fn();const {container}=render(<Panel onClose={close}/>);
    expect(screen.getByText("Seat 7 more players")).toBeVisible();
    expect(container.querySelector(".setup-findings")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button",{name:"Go to seating"}));expect(close).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button",{name:"Deal roles"})).toBeNull();
  });
  it("opens visual role selection to repair an incomplete pool", () => {
    store.getState().setRolePool(standardRoles(5).slice(0,4));render(<Panel/>);
    expect(screen.getByText("Choose 1 more role")).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"Choose roles"}));
    expect(screen.getByRole("heading",{name:"Choose roles"})).toHaveFocus();
    fireEvent.click(screen.getByRole("button",{name:"Imp"}));
    fireEvent.click(screen.getByRole("button",{name:"Done choosing"}));
    expect(screen.getByRole("button",{name:"Deal roles"})).toHaveFocus();
  });
  it("unconfigured setup never reports a false ready/no-issues state", () => {
    store.getState().newGame(setupScript.id);render(<Panel/>);
    expect(screen.getByText("Choose the number of players")).toBeVisible();
    expect(screen.queryByText(/No issues|Ready to deal|Setup ready/)).toBeNull();
  });
  it("changing count never allocates seats", () => {
    render(<Panel/>);fireEvent.change(screen.getByLabelText("Players"),{target:{value:"6"}});
    expect(store.getState().game!.plannedPlayerCount).toBe(6);expect(store.getState().game!.seatOrder).toHaveLength(5);
    expect(screen.getByText("Seat 1 more player")).toBeVisible();
  });
  it.each(Object.keys(SETUP_COUNTS).map(Number))("displays canonical composition for %i players", count=>{
    prepare(standardRoles(count));render(<Panel/>);
    const dl=screen.getByLabelText("Expected composition");
    expect([...dl.querySelectorAll("dd")].map(e=>Number(e.textContent))).toEqual(Object.values(SETUP_COUNTS[count]!));
  });
  it("displays Baron-adjusted distribution without changing player count",()=>{
    prepare(["washerwoman","drunk","saint","baron","imp"]);render(<Panel/>);
    expect([...screen.getByLabelText("Expected composition").querySelectorAll("dd")].map(e=>e.textContent)).toEqual(["1","2","1","1"]);
    expect(screen.getByLabelText("Players")).toHaveValue(5);
  });
  it("unsupported interactions show a check and clearly label the baseline",()=>{
    prepare(["washerwoman","drunk","saint","baron","fanggu"]);render(<Panel/>);
    expect(screen.getByText("Standard roles · before special setup")).toBeVisible();
    expect(screen.getByText(/confirm the composition/)).toBeVisible();
    expect(screen.getByRole("button",{name:"Deal roles"})).toBeEnabled();
  });
  it("Travelers remain separate and excluded from the deal", () => {
    const game=store.getState().game!;game.players.t=makeSTPlayer({id:"t",seat:5,isTraveler:true,actualRole:"thief",actualAlignment:"evil"});game.seatOrder.push("t");
    render(<Panel/>);expect(screen.getByText("+ 1 Traveler")).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"Deal roles"}));
    expect(store.getState().game!.players.t).toMatchObject({actualRole:"thief",actualAlignment:"evil"});
    expect(store.getState().game!.plannedPlayerCount).toBe(5);
  });
  it("Traveler character contradictions still block the deal", () => {
    const game=store.getState().game!;game.players.t=makeSTPlayer({id:"t",seat:5,isTraveler:true,actualRole:"chef"});game.seatOrder.push("t");
    render(<Panel/>);expect(screen.getByText("Choose a character for each Traveler")).toBeVisible();
    expect(screen.queryByRole("button",{name:"Deal roles"})).toBeNull();
  });
  it("warnings remain in collapsed details and never veto a safe deal", () => {
    prepare(["chef","chef","washerwoman","poisoner","imp"]);
    const {container}=render(<Panel/>);expect(container.querySelector(".setup-findings")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button",{name:/Review roles/}));
    expect(container.querySelector(".setup-findings")).toHaveAttribute("open");
    screen.getAllByText(/appears 2 times/).forEach(e=>expect(e).toBeVisible());
    expect(screen.getByRole("button",{name:"Deal roles"})).toBeEnabled();
  });
  it("execution rechecks readiness after a stale render", () => {
    render(<Panel/>);const button=screen.getByRole("button",{name:"Deal roles"});
    act(()=>{store.getState().unseatPlayer(store.getState().game!.seatOrder[0]!);fireEvent.click(button);});
    expect(screen.getByRole("alert")).toHaveTextContent("Setup changed");expect(store.getState().game!.phase).toBe("setup");
  });
  it("reduces duplicate copies without clearing the selected character", () => {
    prepare(["villageidiot","villageidiot","villageidiot","poisoner","imp"]);render(<Panel/>);
    fireEvent.click(screen.getByRole("button",{name:"Edit roles"}));
    fireEvent.click(screen.getByText("Additional copies"));
    fireEvent.click(screen.getByRole("button",{name:"Remove one Village Idiot"}));
    expect(store.getState().game!.rolePool.filter(id=>id==="villageidiot")).toHaveLength(2);
    expect(screen.getByRole("button",{name:"Village Idiot ×2"})).toHaveAttribute("aria-pressed","true");
  });
  it("Gardener guidance directs individual changes after the random deal", () => {
    store.getState().setLorics(["gardener"]);render(<Panel/>);
    fireEvent.click(screen.getByText("Review setup details"));
    expect(screen.getByText(/Gardener: review the intended placement/)).toBeVisible();
    expect(screen.queryByText(/Use manual assignment/)).toBeNull();
    expect(screen.getByRole("button",{name:"Deal roles"})).toBeEnabled();
  });
  it("Privacy Mode removes sensitive setup from the DOM and accessibility tree", () => {
    prepare(["atheist","chef","empath","poisoner","imp"]);render(<Panel foreground/>);
    expect(screen.getByRole("dialog")).toBeInTheDocument();act(()=>usePrivacyStore.setState({enabled:true}));
    expect(screen.queryByRole("dialog")).toBeNull();expect(screen.queryByText(/Atheist/)).toBeNull();expect(screen.queryByLabelText("Players")).toBeNull();
  });
  it("foreground setup retains modal focus and background isolation", () => {
    const {container}=render(<><button>Background</button><Panel foreground/></>);
    const dialog=screen.getByRole("dialog",{name:"Setup"});expect(dialog).toHaveAttribute("aria-modal","true");
    expect(dialog.contains(document.activeElement)).toBe(true);expect(container.querySelector("button")!.closest("[inert]")).not.toBeNull();
    expect(within(dialog).getByLabelText("Players")).toBeInTheDocument();
  });
  it("GameScreen has no competing initial manual-start action", () => {
    render(<GameScreen/>);
    fireEvent.click(screen.getByRole("button",{name:"setup"}));
    expect(screen.queryByRole("button",{name:"Begin night 1"})).toBeNull();
    expect(screen.getByRole("button",{name:"Deal roles"})).toBeInTheDocument();
  });
  it("Setup toolbar keeps Travelers separate from ordinary players", () => {
    const game=store.getState().game!;game.players.t=makeSTPlayer({id:"t",seat:5,isTraveler:true,actualRole:"thief"});game.seatOrder.push("t");
    render(<GameScreen/>);
    expect(screen.getByText("5 players · 1 Traveler")).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"setup"}));
    expect(screen.getByText("+ 1 Traveler")).toBeVisible();
  });
  it("Setup uses canonical Sentinel ranges with exact combinations on demand", () => {
    store.getState().newGame(setupScript.id, { plannedPlayerCount: 8, plannedRoles: standardRoles(8), plannedFabled: ["sentinel"] });
    for (let i = 0; i < 8; i++) store.getState().addPlayerToSeat("Player " + i);
    render(<Panel/>);
    expect(screen.getByText("4–6")).toBeVisible();expect(screen.getByText("0–2")).toBeVisible();
    expect(screen.getByText("Allowed combinations").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText(/Reconcile the target/)).toBeNull();
  });
});
