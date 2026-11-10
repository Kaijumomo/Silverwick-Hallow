import { useState } from "react";
import { isTabletTrial } from "@/config/trial";
import type { ReferenceCategory } from "./referenceCategories";
import { PhoneHome } from "@/features/player/phone/PhoneHome";
import { PhoneReferenceScript } from "@/features/player/phone/PhoneReferenceScript";
import { PhoneReferencePicker } from "@/features/player/phone/PhoneReferencePicker";
import { PhoneFrame } from "@/features/player/phone/PhoneParts";
import { HowToPlayPhone } from "@/features/howto/HowToPlay";

type Props = {
  /** Page navigation; injectable for tests. Defaults to a normal page load. */
  navigate?: (url: string) => void;
};

function defaultNavigate(url: string) {
  window.location.assign(url);
}

/**
 * Home on a phone (Package 3, D9): the player design, Player, Character Reference and How to Play (design v7). The tablet has its
 * own Home (grimoire-v6/home/HomeV6); the desktop Home that used to live here was unreachable and was removed
 * (streamlining review F-06).
 */
export function HomeScreen({ navigate = defaultNavigate }: Props) {
  const [reference, setReference] = useState<ReferenceCategory | null>(null);
  const [phoneReference, setPhoneReference] = useState(false);
  const [howStep, setHowStep] = useState<number | null>(null);
  return (
    <>
      {!reference && !phoneReference && howStep === null && (
        <PhoneHome
          trial={isTabletTrial}
          onPick={(id) => {
            if (id === "player") navigate("?join=");
            else if (id === "howto") setHowStep(0);
            else setPhoneReference(true);
          }}
        />
      )}
      {howStep !== null && (
        <PhoneFrame label="howto">
          <HowToPlayPhone step={howStep} onStep={setHowStep} onClose={() => setHowStep(null)} />
        </PhoneFrame>
      )}
      {!reference && phoneReference && (
        <PhoneReferencePicker onBack={() => setPhoneReference(false)} onOpen={setReference} />
      )}
      {reference && <PhoneReferenceScript category={reference} onBack={() => setReference(null)} />}
    </>
  );
}
