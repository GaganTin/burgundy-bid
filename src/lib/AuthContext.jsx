import React, { createContext, useState, useContext, useEffect } from 'react';
import { client } from '@/api/client';
import { appParams } from '@/lib/app-params';
import { queryClientInstance } from '@/lib/query-client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);
      // Restore auth from localStorage — this is a self-hosted app so there is no
      // external public-settings endpoint to call. Auth is entirely JWT-based.
      await refreshAuthFromLocal();
      setIsLoadingPublicSettings(false);
    } catch (error) {
      console.error('checkAppState error:', error);
      setAuthError({ type: 'unknown', message: error.message || 'Unexpected error' });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  };

  const checkUserAuth = async () => {
    try {
      // Now check if the user is authenticated
      setIsLoadingAuth(true);
      const currentUser = await client.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
    } catch (error) {
      console.error('User auth check failed:', error);
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
      
      // If user auth fails, it might be an expired token
      if (error.status === 401 || error.status === 403) {
        setAuthError({
          type: 'auth_required',
          message: 'Authentication required'
        });
      }
    }
  };

  const refreshAuthFromLocal = async () => {
    try {
      setIsLoadingAuth(true);
      setAuthError(null);
      const rawUser = localStorage.getItem('app_current_user');
      const token = localStorage.getItem('app_access_token');
      if (rawUser && token) {
        try {
          const currentUser = await client.auth.me();
          if (currentUser) {
            // Clear any cached data from a previous user before setting the new session.
            queryClientInstance.clear();
            setUser(currentUser);
            setIsAuthenticated(true);
          } else {
            // me() returned null — JWT was invalid/expired and localStorage was
            // already cleared by _tryRefresh. Treat as logged out.
            setUser(null);
            setIsAuthenticated(false);
          }
        } catch (_) {
          // me() threw (network error etc.) — fall back to cached user
          queryClientInstance.clear();
          setUser(JSON.parse(rawUser));
          setIsAuthenticated(true);
        }
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error('refreshAuthFromLocal failed', err);
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    queryClientInstance.clear();

    if (shouldRedirect) {
      client.auth.logout(window.location.href);
    } else {
      client.auth.logout();
    }
  };

  const navigateToLogin = () => {
    // Use the client's redirectToLogin method
    client.auth.redirectToLogin(window.location.href);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkAppState,
      refreshAuthFromLocal
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
