import React, {createContext, useContext, useEffect, useState} from 'react';
import type {ManagerProcessDiagnostics} from './contracts.js';
import {api, errorMessage} from '../ui/support.js';

interface ProcessInventory {
  readonly diagnostics?: ManagerProcessDiagnostics;
  readonly loadError: string;
  readonly load: (signal?: AbortSignal) => Promise<void>;
}

const ProcessInventoryContext = createContext<ProcessInventory | undefined>(undefined);

function useProcessInventory(enabled: boolean): ProcessInventory {
  const [diagnostics, setDiagnostics] = useState<ManagerProcessDiagnostics>();
  const [loadError, setLoadError] = useState('');
  const load = async (signal?: AbortSignal): Promise<void> => {
    try {
      const next = await api<ManagerProcessDiagnostics>('/api/processes', undefined, {
        signal,
        timeoutMilliseconds: 8_000,
      });
      if (signal?.aborted) return;
      setDiagnostics(next);
      setLoadError('');
    } catch (cause) {
      if (!signal?.aborted) setLoadError(errorMessage(cause));
    }
  };
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const poll = async (): Promise<void> => {
      await load(controller.signal);
      if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), 2_000);
    };
    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled]);
  return {diagnostics, loadError, load};
}

export function ManagerProcessesProvider({children}: {readonly children: React.ReactNode}): React.ReactElement {
  const inventory = useProcessInventory(true);
  return <ProcessInventoryContext.Provider value={inventory}>{children}</ProcessInventoryContext.Provider>;
}

export function useManagerProcesses(): ProcessInventory {
  const shared = useContext(ProcessInventoryContext);
  const local = useProcessInventory(shared === undefined);
  return shared ?? local;
}
