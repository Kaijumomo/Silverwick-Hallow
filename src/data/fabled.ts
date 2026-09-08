import { canonicalRoles } from "@/data/canonical";
import type { RoleDef, RoleId } from "@/stores/types";

export const FABLED: RoleDef[] = canonicalRoles(["angel","buddhist","doomsayer","hellslibrarian","fiddler","revolutionary","toymaker","djinn","duchess","fibbin","sentinel","spiritofivory"]);

export const getFabled = (id: RoleId): RoleDef | undefined => FABLED.find(role => role.id === id);
export const listFabled = (): RoleDef[] => FABLED;
