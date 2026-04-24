"use client";

import { createContext, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

type WorkspaceNavbarTrailContextValue = {
  trail: ReactNode | null;
  /** Shown in the header actions row, immediately before `endSlot` (e.g. logout). */
  endLead: ReactNode | null;
  setWorkspaceNavbarTrail: Dispatch<SetStateAction<ReactNode | null>>;
  setWorkspaceNavbarEndLead: Dispatch<SetStateAction<ReactNode | null>>;
};

const WorkspaceNavbarTrailContext = createContext<WorkspaceNavbarTrailContextValue | null>(null);

export function WorkspaceNavbarTrailProvider({ children }: { children: ReactNode }) {
  const [trail, setWorkspaceNavbarTrail] = useState<ReactNode | null>(null);
  const [endLead, setWorkspaceNavbarEndLead] = useState<ReactNode | null>(null);
  const value = useMemo(
    () => ({ trail, endLead, setWorkspaceNavbarTrail, setWorkspaceNavbarEndLead }),
    [trail, endLead],
  );
  return (
    <WorkspaceNavbarTrailContext.Provider value={value}>{children}</WorkspaceNavbarTrailContext.Provider>
  );
}

export function useWorkspaceNavbarTrail() {
  const ctx = useContext(WorkspaceNavbarTrailContext);
  if (!ctx) {
    return {
      trail: null as ReactNode | null,
      endLead: null as ReactNode | null,
      setWorkspaceNavbarTrail: (() => {}) as Dispatch<SetStateAction<ReactNode | null>>,
      setWorkspaceNavbarEndLead: (() => {}) as Dispatch<SetStateAction<ReactNode | null>>,
    };
  }
  return ctx;
}
