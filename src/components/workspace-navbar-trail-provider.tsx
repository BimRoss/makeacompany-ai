"use client";

import { createContext, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

type WorkspaceNavbarTrailContextValue = {
  trail: ReactNode | null;
  setWorkspaceNavbarTrail: Dispatch<SetStateAction<ReactNode | null>>;
};

const WorkspaceNavbarTrailContext = createContext<WorkspaceNavbarTrailContextValue | null>(null);

export function WorkspaceNavbarTrailProvider({ children }: { children: ReactNode }) {
  const [trail, setWorkspaceNavbarTrail] = useState<ReactNode | null>(null);
  const value = useMemo(
    () => ({ trail, setWorkspaceNavbarTrail }),
    [trail],
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
      setWorkspaceNavbarTrail: (_: SetStateAction<ReactNode | null>) => {},
    };
  }
  return ctx;
}
