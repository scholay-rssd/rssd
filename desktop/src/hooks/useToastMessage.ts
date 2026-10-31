import { useCallback, useEffect, useRef, useState } from "react";
import { toast, useToasts, type ToastTone } from "../toast";

/** Retain local failure state (for empty views), while showing feedback globally.
 * Each call is a new notice, even when the text repeats after auto-dismissal. */
export function useToastMessage(tone: ToastTone = "error") {
  const [message, setMessage] = useState({ text: "" });
  const toastId = useRef<number | undefined>(undefined);
  const notify = useCallback((text: string) => setMessage({ text }), []);

  useEffect(() => {
    if (message.text) {
      toastId.current = tone === "error" ? toast.error(message.text) : toast.show(message.text);
    } else if (toastId.current !== undefined) {
      // Clearing one pane's error must never dismiss a newer notice from another.
      useToasts.getState().dismiss(toastId.current);
      toastId.current = undefined;
    }
  }, [message, tone]);

  return [message.text, notify] as const;
}
