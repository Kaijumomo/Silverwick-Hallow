/** Runtime-only bridge: voting can check the existing writer without a
 * store -> synchronization -> store import cycle. Online defaults to refusal
 * until the synchronization runtime registers its own authority reader. */
export type VotingAuthorityScope = { code: string; uid: string; sessionId?: string; status: "live" | "reconnecting" };
let readAuthority: (scope: VotingAuthorityScope) => string | null = () => null;
export function registerVotingAuthorityReader(reader: typeof readAuthority): void {
  readAuthority = reader;
}
export function votingAuthorityToken(scope: VotingAuthorityScope | null): string | null {
  return scope ? readAuthority(scope) : "offline";
}
