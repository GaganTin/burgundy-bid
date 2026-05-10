import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, isAuthenticated } = useAuth();

  // Debug: log auth state to help trace unexpected redirects
  console.debug('AuthState', { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated });

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors: show registration flow for that case.
  // Do NOT perform a global redirect for `auth_required` here — routing
  // should control access per-page so the public Home (`/`) remains accessible.
  if (authError && authError.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  // Render the main app
  return (
    <Routes>
      {/* Ensure legacy `/Home` path redirects to root `/` */}
      <Route path="/Home" element={<Navigate to="/" replace />} />
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => {
        // Skip emitting a separate `/Home` route when the page is the configured main page
        if (path === mainPageKey) return null;
        const protectedPages = new Set(["Lookup", "Connections", "Profile", "Workspace"]);
        const element = (
          <LayoutWrapper currentPageName={path}>
            <Page />
          </LayoutWrapper>
        );

        // RequireAuth wrapper: only redirect to Authentication when attempting to
        // visit a protected page while unauthenticated. Home (`/`) remains public.
        const RequireAuth = ({ children }) => {
          if (!isAuthenticated) return <Navigate to="/Authentication" replace />;
          return children;
        };

        if (protectedPages.has(path)) {
          return (
            <Route key={path} path={`/${path}`} element={<RequireAuth>{element}</RequireAuth>} />
          );
        }

        return (
          <Route key={path} path={`/${path}`} element={element} />
        );
      })}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <NavigationTracker />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App


