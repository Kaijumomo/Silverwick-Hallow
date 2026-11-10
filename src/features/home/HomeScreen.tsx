import { useState } from "react";
import { isTabletTrial } from "@/config/trial";
import type { ReferenceCategory } from "./referenceCategories";
import { PhoneHome } from "@/features/player/phone/PhoneHome";
import { PhoneReferenceScript } from "@/features/player/phone/PhoneReferenceScript";
import { PhoneReferencePicker } from "@/features/player/phone/PhoneReferencePicker";
import { displayCode, rejoinUrl, savedGameCode } from "@/features/player/phone/rejoin";

type Props = {
  /** Page navigation; injectable for tests. Defaults to a normal page load. */
  navigate?: (url: string) => void;
};

function defaultNavigate(url: string) {
  window.location.assign(url);
}

/**
 * Home on a phone (Package 3, D9): the player design, Player and Character Reference only. The tablet has its
 * own Home (grimoire-v6/home/HomeV6); the desktop Home that used to live here was unreachable and was removed
 * (streamlining review F-06).
 */
export function HomeScreen({ navigate = defaultNavigate }: Props) {
  const [reference, setReference] = useState<ReferenceCategory | null>(null);
  const [phoneReference, setPhoneReference] = useState(false);
  // A game saved on this phone (e.g. the installed app was closed and reopened at Home).
  const [savedCode] = useState(() => (isTabletTrial ? null : savedGameCode()));
  return (
    <>
      {!reference && !phoneReference && (
        <PhoneHome
          trial={isTabletTrial}
          {...(savedCode ? { rejoin: { label: `Game ${displayCode(savedCode)}`, onRejoin: () => navigate(rejoinUrl(savedCode)) } } : {})}
          onPick={(id) => {
            if (id === "player") navigate("?join=");
            else setPhoneReference(true);
          }}
        />
      )}
      {!reference && phoneReference && (
        <PhoneReferencePicker onBack={() => setPhoneReference(false)} onOpen={setReference} />
      )}
      {reference && <PhoneReferenceScript category={reference} onBack={() => setReference(null)} />}
    </>
  );
}
