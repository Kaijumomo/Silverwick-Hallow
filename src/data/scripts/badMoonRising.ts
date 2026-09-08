import { canonicalRoles } from "@/data/canonical";
import type { Script } from "@/stores/types";

export const badMoonRising: Script = {
  id: "bmr",
  name: "Bad Moon Rising",
  characters: canonicalRoles(["grandmother","sailor","chambermaid","exorcist","innkeeper","gambler","gossip","courtier","professor","minstrel","tealady","pacifist","fool","tinker","moonchild","goon","lunatic","godfather","devilsadvocate","assassin","mastermind","zombuul","pukka","shabaloth","po"]),
};
