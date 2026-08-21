import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type PropsWithChildren, useContext, useState } from "react";

import { api, ApiError } from "../api/client";
import type { Credentials, User } from "../api/types";
import { cacheOfflineUser, clearOfflineUser, readOfflineUser } from "./offlineUserCache";
import { ensureLocalUserCryptoIdentity } from "../key-management/userIdentity";

const authQueryKey = ["auth", "me"] as const;

interface AuthContextValue {
  ensureIdentity: (accountPassword: string) => Promise<void>;
  error: Error | null;
  identityError: Error | null;
  isLoading: boolean;
  login: (credentials: Credentials) => Promise<void>;
  logout: () => Promise<void>;
  register: (credentials: Credentials) => Promise<void>;
  user: User | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [identityError, setIdentityError] = useState<Error | null>(null);
  const authQuery = useQuery({
    queryKey: authQueryKey,
    queryFn: async () => {
      try {
        const user = (await api.auth.me()).user;
        cacheOfflineUser(user);
        return user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          clearOfflineUser();
          return null;
        }
        const cachedUser = readOfflineUser();
        if (cachedUser) return cachedUser;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000
  });

  const establishSession = async (
    operation: () => Promise<{ user: User }>,
    accountPassword: string
  ): Promise<void> => {
    const { user } = await operation();
    cacheOfflineUser(user);
    queryClient.setQueryData(authQueryKey, user);
    try {
      await ensureLocalUserCryptoIdentity(user, accountPassword);
      setIdentityError(null);
    } catch (error) {
      setIdentityError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  return (
    <AuthContext.Provider
      value={{
        ensureIdentity: async (accountPassword) => {
          const user = queryClient.getQueryData<User>(authQueryKey);
          if (!user) throw new Error("Sign in before setting up an encryption identity.");
          try {
            await ensureLocalUserCryptoIdentity(user, accountPassword);
            setIdentityError(null);
          } catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));
            setIdentityError(normalized);
            throw normalized;
          }
        },
        error: authQuery.error,
        identityError,
        isLoading: authQuery.isLoading,
        login: (credentials) => establishSession(() => api.auth.login(credentials), credentials.password),
        logout: async () => {
          await api.auth.logout();
          clearOfflineUser();
          setIdentityError(null);
          queryClient.setQueryData(authQueryKey, null);
          queryClient.removeQueries({
            predicate: (query) => query.queryKey[0] !== authQueryKey[0]
          });
        },
        register: (credentials) => establishSession(() => api.auth.register(credentials), credentials.password),
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
