import { canonicalRoles } from "@/data/canonical";
import type { RoleDef, RoleId } from "@/stores/types";

export const LORICS: RoleDef[] = canonicalRoles(["bigwig","bootlegger","gardener","godofug","hindu","knaves","pope","stormcatcher","tor","ventriloquist","zenomancer"]);

export const getLoric = (id: RoleId): RoleDef | undefined => LORICS.find(role => role.id === id);
export const listLorics = (): RoleDef[] => LORICS;
