import { iconUrlFor } from "@/data/iconUrl";
import { travellerArt } from "@/data/localArt";
import type { RoleDef } from "@/stores/types";

/** The art for a character token: committed local Traveller art first. */
export const roleArt = (role: RoleDef): string =>
  (role.type === "traveler" ? travellerArt(role.id) : undefined) ?? iconUrlFor(role);
