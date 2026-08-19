import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type PropsWithChildren, useContext } from "react";

import { api, ApiError } from "../api/client";
import type { Credentials, User } from "../api/types";

const authQueryKey = ["auth", "me"] as const;

interface AuthContextValue {
  error: Error | null;
  isLoading: boolean;
  login: (credentials: Credentials) => Promise<void>;
  logout: () => Promise<void>;
  register: (credentials: Credentials) => Promise<void>;
  user: User | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const authQuery = useQuery({
    queryKey: authQueryKey,
    queryFn: async () => {
      try {
        return (await api.auth.me()).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000
  });

  const establishSession = async (
    operation: () => Promise<{ user: User }>
  ): Promise<void> => {
    const { user } = await operation();
    queryClient.setQueryData(authQueryKey, user);
  };

  return (
    <AuthContext.Provider
      value={{
        error: authQuery.error,
        isLoading: authQuery.isLoading,
        login: (credentials) => establishSession(() => api.auth.login(credentials)),
        logout: async () => {
          await api.auth.logout();
          queryClient.setQueryData(authQueryKey, null);
          queryClient.removeQueries({
            predicate: (query) => query.queryKey[0] !== authQueryKey[0]
          });
        },
        register: (credentials) => establishSession(() => api.auth.register(credentials)),
        user: authQuery.data ?? null
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
