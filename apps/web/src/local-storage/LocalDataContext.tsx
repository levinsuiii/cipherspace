import { liveQuery } from "dexie";
import {
  createContext,
  type DependencyList,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";

import { localDatabase } from "./database";
import { LocalNotesRepository } from "./repository";

const LocalDataContext = createContext<LocalNotesRepository | null>(null);

export function LocalDataProvider({ children, userId }: PropsWithChildren<{ userId: string }>) {
  const repository = useMemo(() => new LocalNotesRepository(localDatabase, userId), [userId]);
  return <LocalDataContext.Provider value={repository}>{children}</LocalDataContext.Provider>;
}

export function useLocalData(): LocalNotesRepository {
  const repository = useContext(LocalDataContext);
  if (!repository) {
    throw new Error("useLocalData must be used inside LocalDataProvider");
  }
  return repository;
}

interface LocalQueryResult<T> {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
}

export function useLocalQuery<T>(
  query: () => Promise<T>,
  dependencies: DependencyList
): LocalQueryResult<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setError(null);
    const subscription = liveQuery(query).subscribe({
      error: (caught) => setError(caught instanceof Error ? caught : new Error(String(caught))),
      next: setData
    });
    return () => subscription.unsubscribe();
    // Callers explicitly describe the reactive query dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return { data, error, isLoading: data === undefined && error === null };
}
