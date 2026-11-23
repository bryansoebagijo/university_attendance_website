"use client";

/**
 * App-wide UI state: toast notifications.
 * (In phases 1–4 this also held browser-side sample data; all data now comes from the backend.)
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

function useStoreValue() {
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  return useMemo(() => ({ toast, notify }), [toast, notify]);
}

type Store = ReturnType<typeof useStoreValue>;
const StoreCtx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue();
  return (
    <StoreCtx.Provider value={value}>
      {children}
      {value.toast && (
        <div className="toast" role="status">
          {value.toast}
        </div>
      )}
    </StoreCtx.Provider>
  );
}

export function useStore() {
  const s = useContext(StoreCtx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
