import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "./utils";
import { client } from "@/api/client";
import { User, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from '@/lib/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Layout({ children, currentPageName }) {
  const { isAuthenticated, user } = useAuth();

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark") {
      document.documentElement.classList.add("dark");
    }
  }, []);

  const navItems = [
    { name: "Lookup", page: "Lookup" },
    { name: "Connections", page: "Connections" },
    { name: "Profile", page: "Profile" },
    ...(user?.role_type === "admin" ? [{ name: "Workspace", page: "Workspace" }] : []),
    // { name: "Docs", page: "Docs" },
  ];

  const handleLogout = () => {
    client.auth.logout('/');
  };

  const handleLogin = () => {
    client.auth.redirectToLogin();
  };

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-black">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap');
        .font-serif { font-family: 'Playfair Display', Georgia, serif; }
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; -webkit-font-smoothing: antialiased; }
      `}</style>

      {isAuthenticated && !["Home","Authentication","ContactUs","TermsOfService","PrivacyPolicy"].includes(currentPageName) && (
        <nav className="bg-white dark:bg-gray-950 border-b border-gray-100 dark:border-gray-800 sticky top-0 z-50">
          <div className="px-4 sm:px-6 lg:px-12 xl:px-16">
            {/* Top row: logo + account */}
            <div className="flex items-center h-12 lg:h-14 relative">
              {/* Logo */}
              <Link to={createPageUrl("Lookup")}>
                <div className="flex items-center gap-1.5 lg:gap-2">
                  <img src="/logo.png" alt="Burgundy Bid" className="w-6 h-6 lg:w-8 lg:h-8 object-contain" />
                  <span className="font-serif text-lg lg:text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Burgundy Bid</span>
                </div>
              </Link>

              {/* Desktop nav - center (hidden on mobile, shown below instead) */}
              <div className="hidden lg:flex absolute left-1/2 -translate-x-1/2 items-center gap-1">
                {navItems.map((item) => {
                  const isActive = currentPageName === item.page;
                  return (
                    <Link
                      key={item.page}
                      to={createPageUrl(item.page)}
                      className={`px-3.5 py-2 rounded-lg text-base font-serif transition-colors ${
                        isActive
                          ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-semibold"
                          : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900 font-medium"
                      }`}
                    >
                      {item.name}
                    </Link>
                  );
                })}
              </div>

              {/* Account - right */}
              <div className="ml-auto">
                {isAuthenticated ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="hidden sm:flex items-center gap-2 px-2 lg:px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
                        <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                          <User className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                        </div>
                        <span className="hidden sm:inline text-sm font-medium text-gray-700 dark:text-gray-300">
                          {user?.full_name || user?.email?.split("@")[0] || "Account"}
                        </span>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <div className="px-3 py-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{user?.full_name || (user?.email ? user.email.split("@")[0] : "User")}</p>
                        <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                      </div>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleLogout} className="text-red-600 cursor-pointer">
                        <LogOut className="w-4 h-4 mr-2" />
                        Log out
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </div>

            {/* Mobile nav row — scrolls horizontally, hidden on lg+ */}
            <div className="flex lg:hidden overflow-x-auto gap-1 pb-2">
              {navItems.map((item) => {
                const isActive = currentPageName === item.page;
                return (
                  <Link
                    key={item.page}
                    to={createPageUrl(item.page)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-serif transition-colors flex-shrink-0 ${
                      isActive
                        ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-semibold"
                        : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 font-medium"
                    }`}
                  >
                    {item.name}
                  </Link>
                );
              })}
              <button
                onClick={handleLogout}
                className="ml-auto flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-serif text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors font-medium"
              >
                <LogOut className="w-3.5 h-3.5" />
                Log out
              </button>
            </div>
          </div>
        </nav>
      )}

      {children}
    </div>
  );
}