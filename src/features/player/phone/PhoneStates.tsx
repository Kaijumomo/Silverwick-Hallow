import { MoonEmblem, SealEmblem, SeatRingEmblem } from "./PhoneParts";
import { StatusScreen, type StatusAction } from "./StatusScreen";

/** The game code as the design shows it: WICK·7Q3M. */
export function formatCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}·${code.slice(4)}` : code;
}

const dot = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ");

/** 1a: before the join form is usable (the backend is still connecting). */
export function ConnectingScreen() {
  return (
    <StatusScreen
      label="connecting"
      pin
      reserve={50}
      emblem={<MoonEmblem lit spin={16} />}
      eyebrow="Silverwick Hollow"
      title="Connecting…"
      body="Finding the way to the town."
    />
  );
}

/** 1b: after "Enter the Town", while the join request is being written. */
export function KnockingScreen({ code }: { code: string }) {
  return (
    <StatusScreen
      label="knocking"
      pin
      reserve={50}
      emblem={<MoonEmblem lit spin={16} />}
      eyebrow={code ? formatCode(code) : "Silverwick Hollow"}
      title="Knocking…"
      body="Your knock is on its way to the Storyteller."
    />
  );
}

/** 2a: the connection dropped; nothing private is mounted behind this. */
export function ReconnectingScreen({ code, name }: { code: string; name: string }) {
  return (
    <StatusScreen
      label="reconnecting"
      pin
      reserve={50}
      emblem={<MoonEmblem lit spin={8} />}
      eyebrow={dot([code && formatCode(code), name])}
      title="Reconnecting…"
      body="The connection dropped. Your character stays hidden until you are back."
    />
  );
}

/** 2b / 3a / 3c / 3d: an eclipsed moon, the store's own message, retry/cancel. */
export function FailureScreen({ eyebrow, title, message, onRetry, onCancel, onBack, onSettings, label }: {
  eyebrow: string;
  title: string;
  message: string | null;
  onRetry?: () => void;
  onCancel?: () => void;
  onBack?: () => void;
  /** Configuration-related failures only: opens Connection Settings. */
  onSettings?: () => void;
  label: string;
}) {
  const primary: StatusAction | undefined = onRetry
    ? { label: "Retry connection", onClick: onRetry }
    : onBack ? { label: "Back to start", onClick: onBack } : undefined;
  const secondary: StatusAction | undefined = onRetry && onCancel ? { label: "Cancel / request to leave", onClick: onCancel } : undefined;
  return (
    <StatusScreen
      label={label}
      pin
      tone="error"
      emblem={<MoonEmblem lit={false} tone="error" spin={16} />}
      eyebrow={eyebrow}
      title={title}
      message={message}
      primary={primary}
      secondary={secondary}
      link={onSettings ? { label: "Connection Settings", onClick: onSettings } : undefined}
    />
  );
}

/** 4: rejected join request (stamped parchment token). */
export function RejectedScreen({ code, name, message, onBack }: { code: string; name: string; message: string | null; onBack: () => void }) {
  return (
    <StatusScreen
      label="rejected"
      pin
      tone="seal"
      emblem={<SealEmblem name={name} sub="Guest" />}
      eyebrow={code ? formatCode(code) : "Silverwick Hollow"}
      title="Not admitted"
      message={message}
      primary={{ label: "Back to start", onClick: onBack }}
    />
  );
}

/** 5: access revoked (torn token); also where an accepted leave request ends. */
export function RevokedScreen({ code, name, seat, message, onBack }: { code: string; name: string; seat: number | null; message: string | null; onBack: () => void }) {
  return (
    <StatusScreen
      label="revoked"
      pin
      tone="seal"
      emblem={<SealEmblem name={name} torn sub={seat ? `Seat ${seat}` : "Seat"} />}
      eyebrow={dot([code && formatCode(code), name])}
      title="Access revoked"
      message={message}
      primary={{ label: "Back to start", onClick: onBack }}
    />
  );
}

/** 10: a leave request is pending. */
export function LeavingScreen({ code, seat, seatCount }: { code: string; seat: number | null; seatCount: number }) {
  return (
    <StatusScreen
      label="leaving"
      tone="warm"
      reserve={96}
      emblem={<SeatRingEmblem seatNumber={seat ?? 1} seatCount={seatCount} />}
      eyebrow={dot([code && formatCode(code), seat ? `Seat ${seat}` : null])}
      title="Leave request pending"
      body="Your seat is still reserved. Waiting for the Storyteller to accept or decline your request."
    />
  );
}

/** 11: the Storyteller is ending the game (waning crescent, static ring). */
export function EndingScreen({ code }: { code: string }) {
  return (
    <StatusScreen
      label="ending"
      pin
      reserve={50}
      emblem={<MoonEmblem lit spin={0} shade={44} />}
      eyebrow={code ? formatCode(code) : "Silverwick Hollow"}
      title="Ending…"
      body="The Storyteller is ending the game."
    />
  );
}
