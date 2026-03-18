import React, { useState, useEffect } from "react";
import { AlertCircle } from "lucide-react";
import LoginScreen from "./components/LoginScreen";
import Dashboard from "./components/Dashboard";
import { supabase } from "./utils/supabaseClient";

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const isSupabaseConfigured = 
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY;

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    // Check active session on load
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) {
        const rememberMe = localStorage.getItem("rememberMe") === "true";
        const tempSession = sessionStorage.getItem("tempSession") === "true";

        if (!rememberMe && !tempSession) {
          // 如果沒有勾選記住我，且不是當前 session，則登出
          supabase.auth.signOut();
          setIsLoggedIn(false);
          setUserEmail("");
        } else {
          setIsLoggedIn(true);
          setUserEmail(session.user.email);
        }
      }
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.email) {
        setIsLoggedIn(true);
        setUserEmail(session.user.email);
      } else {
        setIsLoggedIn(false);
        setUserEmail("");
      }
    });

    return () => subscription.unsubscribe();
  }, [isSupabaseConfigured]);

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <div className="max-w-md w-full bg-slate-900 border border-red-500/50 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center gap-3 text-red-500 mb-4">
            <AlertCircle className="w-8 h-8" />
            <h2 className="text-xl font-bold">缺少 Supabase 設定</h2>
          </div>
          <p className="text-slate-300 mb-4">
            請在專案的環境變數中設定您的 Supabase 專案資訊，才能正常執行此應用程式。
          </p>
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-sm text-slate-400 overflow-x-auto">
            <p>VITE_SUPABASE_URL="您的_URL"</p>
            <p>VITE_SUPABASE_ANON_KEY="您的_KEY"</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <LoginScreen
        onLogin={(email) => {
          setIsLoggedIn(true);
          setUserEmail(email);
        }}
      />
    );
  }

  return (
    <Dashboard
      email={userEmail}
      onLogout={() => {
        setIsLoggedIn(false);
        setUserEmail("");
      }}
    />
  );
}
