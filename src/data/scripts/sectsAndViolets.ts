import { canonicalRoles } from "@/data/canonical";
import type { Script } from "@/stores/types";

export const sectsAndViolets: Script = {
  id: "snv",
  name: "Sects & Violets",
  characters: canonicalRoles(["clockmaker","dreamer","snakecharmer","mathematician","flowergirl","towncrier","oracle","savant","seamstress","philosopher","artist","juggler","sage","mutant","sweetheart","barber","klutz","eviltwin","witch","cerenovus","pithag","fanggu","vigormortis","nodashii","vortox"]),
};
