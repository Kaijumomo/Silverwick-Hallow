import { canonicalRoles } from "@/data/canonical";
import type { Script } from "@/stores/types";

export const troubleBrewing: Script = {
  id: "tb",
  name: "Trouble Brewing",
  characters: canonicalRoles(["washerwoman","librarian","investigator","chef","empath","fortuneteller","undertaker","monk","ravenkeeper","virgin","slayer","soldier","mayor","butler","drunk","recluse","saint","poisoner","spy","scarletwoman","baron","imp"]),
};
