import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupPanel } from "./SetupPanel";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { makeSTPlayer } from "@/test/fixtures";
import { GameScreen } from "@/features/game/GameScreen";
import { RolePickerPanel } from "@/features/newgame/RolePickerPanel";

beforeEach(() => {
  usePrivacyStore.setState({enabled:false});
  store.setState({game:setupGame(standardRoles(5)),lobby:null,undoStack:[],customScripts:{[setupScript.id]:setupScript}});
  vi.stubGlobal("ResizeObserver",class {observe(){} disconnect(){}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
function Panel({foreground=false}:{foreground?:boolean}) {
  const game=store(s=>s.game)!;
  return <SetupPanel game={game} script={setupScript} onClose={()=>{}} foreground={foreground} />;
}

describe("Setup workflows and findings", () => {
  it("complete manual assignments start without a random pool", () => {
    render(<Panel/>);
    const button=screen.getByRole("button",{name:"Begin Night 1 with assigned roles"});
    expect(button).toBeEnabled();fireEvent.click(button);expect(store.getState().game!.phase).toBe("night");
  });
  it("seven empty planned seats show consistent disabled deal and a useful reason", () => {
    store.getState().newGame(setupScript.id,{plannedPlayerCount:7,plannedRoles:standardRoles(7)});
    render(<Panel/>);
    expect(screen.getByText(/7 planned · 0 seated · 7 empty/)).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Deal roles & begin Night 1"})).toBeDisabled();
    expect(screen.getAllByText(/Reconcile the target/).length).toBeGreaterThan(0);
  });
  it("pool editing repairs a mismatch", () => {
    store.setState({game:setupGame(standardRoles(5),{rolePool:standardRoles(5).slice(0,4)})});
    render(<Panel/>);expect(screen.getByRole("button",{name:"Deal roles & begin Night 1"})).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Add pooled role"),{target:{value:"imp"}});
    expect(screen.getByRole("button",{name:"Deal roles & begin Night 1"})).toBeEnabled();
  });
  it("clear pool keeps manual truth and switches workflows", () => {
    const roles=standardRoles(5);store.setState({game:setupGame(roles,{rolePool:roles})});
    render(<Panel/>);fireEvent.click(screen.getByRole("button",{name:"Clear pool — keep assignments"}));
    expect(store.getState().game!.rolePool).toEqual([]);
    expect(Object.values(store.getState().game!.players).map(p=>p.actualRole)).toEqual(roles);
    expect(screen.getByRole("button",{name:"Begin Night 1 with assigned roles"})).toBeEnabled();
  });
  it("target changes require deliberate input and never allocate seats", () => {
    render(<Panel/>);fireEvent.change(screen.getByLabelText("Intended non-Traveler players"),{target:{value:"6"}});
    expect(store.getState().game!.plannedPlayerCount).toBe(6);expect(store.getState().game!.seatOrder).toHaveLength(5);
    expect(screen.getByRole("button",{name:"Begin Night 1 with assigned roles"})).toBeDisabled();
  });
  it("Traveler population is separate", () => {
    const game=setupGame(standardRoles(5));game.players.t=makeSTPlayer({id:"t",seat:5,isTraveler:true,actualRole:"thief"});game.seatOrder.push("t");store.setState({game});
    render(<Panel/>);expect(screen.getByText(/5 planned · 5 seated · 0 empty · 1 Traveler/)).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Begin Night 1 with assigned roles"})).toBeEnabled();
  });
  it("deal shows an assigned Traveler blocker rather than hiding its reason", () => {
    const game=setupGame(standardRoles(5),{rolePool:standardRoles(5)});
    game.players.t=makeSTPlayer({id:"t",seat:5,isTraveler:true,actualRole:"chef"});game.seatOrder.push("t");
    store.setState({game});render(<Panel/>);
    expect(screen.getAllByText(/Traveler flag and actual character type/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button",{name:"Deal roles & begin Night 1"})).toBeDisabled();
  });
  it("warnings and checks are visible without disabling a structurally safe start", () => {
    store.setState({game:setupGame(["chef","chef","washerwoman","poisoner","imp"],{lorics:["tor"]})});
    render(<Panel/>);expect(screen.getByText(/Tor:/)).toBeInTheDocument();
    expect(screen.getByText(/appears 2 times/)).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Begin Night 1 with assigned roles"})).toBeEnabled();
  });
  it("renders blockers before checks and warnings", () => {
    store.setState({game:setupGame(["chef","chef","washerwoman","poisoner","imp"],{plannedPlayerCount:7,lorics:["tor"]})});
    const {container}=render(<Panel/>);
    const order=[...container.querySelectorAll("[data-severity]")].map(e=>e.getAttribute("data-severity"));
    expect(order[0]).toBe("blocker");expect(order.indexOf("check")).toBeLessThan(order.indexOf("warning"));
  });
  it("shows a command rejection when rendered readiness became stale", () => {
    render(<Panel/>);
    const button=screen.getByRole("button",{name:"Begin Night 1 with assigned roles"});
    // Simulate another synchronous command between the last render and click.
    act(()=>{
      store.getState().unseatPlayer(store.getState().game!.seatOrder[0]!);
      fireEvent.click(button);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Reconcile/);
    expect(store.getState().game!.phase).toBe("setup");
  });
  it("Privacy Mode removes all setup findings and controls from the DOM", () => {
    store.setState({game:setupGame(["atheist","chef","empath","poisoner","imp"])});
    render(<Panel foreground/>);expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(()=>usePrivacyStore.setState({enabled:true}));
    expect(screen.queryByRole("dialog")).toBeNull();expect(screen.queryByText(/Atheist/)).toBeNull();
    expect(screen.queryByLabelText("Intended non-Traveler players")).toBeNull();
  });
  it("foreground setup uses the existing modal focus and background isolation", () => {
    const {container}=render(<><button>Background</button><Panel foreground/></>);
    const dialog=screen.getByRole("dialog",{name:"Setup"});
    expect(dialog).toHaveAttribute("aria-modal","true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(container.querySelector("button")!.closest("[inert]")).not.toBeNull();
    expect(within(dialog).getByLabelText("Assignment workflow")).toBeInTheDocument();
  });
  it("GameScreen phase advancement uses the manual gate too", () => {
    store.getState().newGame(setupScript.id,{plannedPlayerCount:5,plannedRoles:standardRoles(5)});
    render(<GameScreen/>);
    expect(screen.getByRole("button",{name:"Begin night 1"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Deal roles & begin Night 1"})).toBeDisabled();
  });
  it("New Game preview uses the same Sentinel candidates without pre-start blocker spam", () => {
    render(<RolePickerPanel scriptCharacters={setupScript.characters} rolePool={standardRoles(8)}
      plannedPlayerCount={8} plannedFabled={["sentinel"]} plannedLorics={[]}
      onToggleRole={()=>{}} onToggleFabled={()=>{}} onToggleLoric={()=>{}}/>);
    expect(screen.getByText(/6T \/ 0O \/ 1M \/ 1D or 5T \/ 1O \/ 1M \/ 1D or 4T \/ 2O/)).toBeInTheDocument();
    expect(screen.queryByText(/Reconcile the target/)).toBeNull();
  });
});
