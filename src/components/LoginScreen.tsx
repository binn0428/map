import React, { useState } from "react";
import { Mail, Key, LogIn, UserPlus, AlertCircle } from "lucide-react";
import { supabase } from "../utils/supabaseClient";

export default function LoginScreen({
  onLogin,
}: {
  onLogin: (email: string) => void;
}) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // 模擬 MAC address (瀏覽器無法取得真實 MAC)
  const getSimulatedMac = () => {
    let mac = localStorage.getItem("simulated_mac");
    if (!mac) {
      mac = "XX:XX:XX:XX:XX:XX".replace(/X/g, () =>
        "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16)),
      );
      localStorage.setItem("simulated_mac", mac);
    }
    return mac;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const mac = getSimulatedMac();

    try {
      if (isLogin) {
        // 登入邏輯
        const { data: authData, error: authError } =
          await supabase.auth.signInWithPassword({
            email,
            password,
          });

        if (authError) throw authError;

        // 檢查 registered_emails 中的 MAC
        const { data: emailData, error: emailError } = await supabase
          .from("registered_emails")
          .select("mac")
          .eq("email", email)
          .single();

        if (emailError) throw emailError;

        if (emailData.mac && emailData.mac !== mac) {
          throw new Error("設備 MAC 不符，拒絕登入");
        }

        // 如果 mac 為空，則填上登入帳密的設備 mac
        if (!emailData.mac) {
          const { error: updateError } = await supabase
            .from("registered_emails")
            .update({ mac: mac })
            .eq("email", email);

          if (updateError) throw updateError;
        }

        if (rememberMe) {
          localStorage.setItem("rememberMe", "true");
        } else {
          localStorage.setItem("rememberMe", "false");
          sessionStorage.setItem("tempSession", "true");
        }

        onLogin(email);
      } else {
        // 註冊邏輯
        const { data: authData, error: authError } = await supabase.auth.signUp(
          {
            email,
            password,
          },
        );

        if (authError) throw authError;

        // 註冊後上傳資料到 registered_emails
        const { error: insertError } = await supabase
          .from("registered_emails")
          .insert([{ email, mac: null }]);

        if (insertError) throw insertError;

        alert("註冊成功！請登入。");
        setIsLogin(true);
      }
    } catch (err: any) {
      setError(err.message || "發生錯誤");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950">
      <div className="w-full max-w-md bg-slate-900 rounded-2xl p-8 shadow-2xl border border-slate-800">
        <div className="flex justify-center mb-6">
          <div className="bg-blue-600 p-4 rounded-full">
            {isLogin ? (
              <LogIn className="w-8 h-8 text-white" />
            ) : (
              <UserPlus className="w-8 h-8 text-white" />
            )}
          </div>
        </div>
        <h1 className="text-2xl font-bold text-center text-white mb-2">
          Smart Lock
        </h1>
        <p className="text-slate-400 text-center mb-8">
          {isLogin ? "登入您的控制面板" : "註冊新帳號"}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-xl flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              電子郵件
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              密碼
            </label>
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                required
                minLength={6}
              />
            </div>
          </div>

          {isLogin && (
            <div className="flex items-center">
              <input
                id="remember-me"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-slate-800 border-slate-700 rounded focus:ring-blue-500 focus:ring-2"
              />
              <label
                htmlFor="remember-me"
                className="ml-2 block text-sm text-slate-400"
              >
                記住我
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white font-semibold rounded-xl py-3 mt-6 flex items-center justify-center gap-2 transition-colors"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : isLogin ? (
              <>
                <LogIn className="w-5 h-5" /> 登入系統
              </>
            ) : (
              <>
                <UserPlus className="w-5 h-5" /> 註冊帳號
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setError("");
            }}
            className="text-slate-400 hover:text-white text-sm transition-colors"
          >
            {isLogin ? "還沒有帳號？點此註冊" : "已有帳號？點此登入"}
          </button>
        </div>
      </div>
    </div>
  );
}
