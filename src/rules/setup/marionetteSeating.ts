import type { RoleRegistry } from "@/data/roleRegistry";
import type { RoleId } from "@/stores/types";

/**
 * The Marionette must start next to the Demon. After a random draw, if one Marionette and one Demon are dealt
 * and are not neighbours (ring order), the Marionette swaps with the seat after the Demon. Returns a new array;
 * any other composition is returned unchanged.
 */
export function seatMarionetteBesideDemon(roles: readonly RoleId[], registry: RoleRegistry): { roles: RoleId[]; moved: boolean } {
  const result = [...roles];
  const n = result.length;
  const demons = result.map((id, i) => (registry.get(id)?.type === "demon" ? i : -1)).filter((i) => i >= 0);
  const marionettes = result.map((id, i) => (id === "marionette" ? i : -1)).filter((i) => i >= 0);
  if (n < 3 || demons.length !== 1 || marionettes.length !== 1) return { roles: result, moved: false };
  const d = demons[0]!;
  const m = marionettes[0]!;
  if (m === (d + 1) % n || m === (d + n - 1) % n) return { roles: result, moved: false };
  const next = (d + 1) % n;
  [result[m], result[next]] = [result[next]!, result[m]!];
  return { roles: result, moved: true };
}
