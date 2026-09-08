import { canonicalRoles } from "@/data/canonical";
import type { RoleDef, RoleId } from "@/stores/types";

export const TRAVELERS: RoleDef[] = canonicalRoles(["scapegoat","gunslinger","beggar","bureaucrat","thief","butcher","bonecollector","harlot","barista","deviant","apprentice","matron","voudon","judge","bishop","gangster","gnome"]);

export const getTraveler = (id: RoleId): RoleDef | undefined => TRAVELERS.find(role => role.id === id);
export const listTravelers = (): RoleDef[] => TRAVELERS;
