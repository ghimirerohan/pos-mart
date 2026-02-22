import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { useAuth } from "./useAuth";

interface UserInfo {
  user: string;
  full_name: string;
  email: string;
  roles: string[];
  is_admin_user: boolean;
  is_administrator: boolean;
  admin_roles: string[];
  can_access_date_wise_inventory?: boolean;
  pos_profile: string | null;
  pos_profile_name: string | null;
}

interface UserInfoContextType {
  userInfo: UserInfo | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const UserInfoContext = createContext<UserInfoContextType | undefined>(undefined);

export function UserInfoProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUserInfo = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch("/api/method/klik_pos.api.user.get_current_user_info", {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
        credentials: "include",
      });

      const data = await response.json();

      if (response.ok && data.message?.success) {
        setUserInfo(data.message.data);
        setError(null);
      } else {
        throw new Error(data.message?.error || "Failed to fetch user info");
      }

      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("Error loading user info:", err);
      setError(err.message || "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchUserInfo();
    } else {
      setUserInfo(null);
      setIsLoading(false);
    }
  }, [isAuthenticated, fetchUserInfo]);

  return (
    <UserInfoContext.Provider value={{ userInfo, isLoading, error, refetch: fetchUserInfo }}>
      {children}
    </UserInfoContext.Provider>
  );
}

export function useUserInfo(): UserInfoContextType {
  const context = useContext(UserInfoContext);
  if (context === undefined) {
    throw new Error("useUserInfo must be used within a UserInfoProvider");
  }
  return context;
}
