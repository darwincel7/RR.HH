import React, { useState } from 'react';
import { Outlet, Navigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Briefcase, LayoutDashboard, LogOut, Settings, Users, Sparkles, Menu, X, ChevronLeft, ChevronRight, FileText, Clock } from 'lucide-react';
import WhatsAppStatusBanner from '../WhatsAppStatusBanner';
import CVWorker from '../CVWorker';
import AITestButton from '../AITestButton';

export default function DashboardLayout() {
  const { user, userData, loading, logout, isRecruiter } = useAuth();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Logging out is an explicit STAFF action → send them back to the staff login,
  // never to the public careers portal. A short-lived flag makes the post-logout
  // redirect deterministic despite Firebase's async auth-state update (setting the
  // flag here and reading it in the !user branch avoids a navigate/render race).
  const handleLogout = () => {
    try { sessionStorage.setItem('staffLoggedOut', '1'); } catch { /* storage disabled */ }
    logout();
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50">Loading...</div>;
  }

  if (!user) {
    // Staff who just clicked "Cerrar sesión" go straight to /login.
    let staffLoggedOut = false;
    try {
      staffLoggedOut = sessionStorage.getItem('staffLoggedOut') === '1';
      if (staffLoggedOut) sessionStorage.removeItem('staffLoggedOut');
    } catch { /* storage disabled */ }
    if (staffLoggedOut) return <Navigate to="/login" replace />;

    // The bare domain "/" is where candidates land (links shared on WhatsApp/social).
    // They must reach the PUBLIC careers portal — never a login wall. Deep panel URLs
    // (/candidates, /settings…) are only ever used by staff, so those still go to login.
    const isBareRoot = location.pathname === '/';
    return <Navigate to={isBareRoot ? '/careers' : '/login'} state={{ from: location }} replace />;
  }

  // Anonymous sessions belong to public applicants (created invisibly by the apply
  // flow). They are NOT staff: from the bare root send them to the careers portal.
  // Deep panel links are staff-only (e.g. a recruiter whose browser picked up an
  // anonymous session by testing the apply flow) → send those to /login preserving
  // the destination, exactly like the unauthenticated branch above.
  if (user.isAnonymous) {
    const isBareRoot = location.pathname === '/';
    return <Navigate to={isBareRoot ? '/careers' : '/login'} state={{ from: location }} replace />;
  }

  // Signed in but not yet approved (or blocked) by an admin → hold at a gate screen.
  if (!isRecruiter) {
    const isBlocked = userData?.status === 'blocked';
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-200 p-8 text-center">
          <div className={`w-16 h-16 mx-auto mb-5 rounded-full flex items-center justify-center ${isBlocked ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
            <Clock className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-display font-bold text-slate-900 mb-2">
            {isBlocked ? 'Acceso no autorizado' : 'Esta área es solo para el equipo interno'}
          </h1>
          <p className="text-slate-500 mb-4">
            {isBlocked
              ? 'Un administrador ha restringido el acceso de esta cuenta.'
              : 'No necesitas ninguna cuenta ni aprobación para ver las vacantes y aplicar.'}
          </p>
          {!isBlocked && (
            <>
              {/* Most people who land here are job seekers — put their path FIRST. */}
              <Link
                to="/careers"
                className="w-full flex items-center justify-center px-5 py-3.5 mb-4 rounded-xl bg-violet-700 text-white font-bold hover:bg-violet-800 transition-colors shadow-md"
              >
                <Briefcase className="w-5 h-5 mr-2" /> Ver vacantes y aplicar
              </Link>
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4 text-xs text-amber-800 text-left">
                <strong>¿Eres parte del equipo interno de la empresa?</strong> Comunícate con Darwin
                (daruingmejia@gmail.com) para que apruebe tu cuenta desde el panel de administración.
              </div>
            </>
          )}
          <p className="text-sm text-slate-400 mb-6">
            Iniciaste sesión como <strong className="text-slate-600">{user.email}</strong>.
          </p>
          <button
            onClick={handleLogout}
            className="inline-flex items-center px-5 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 transition-colors"
          >
            <LogOut className="w-4 h-4 mr-2" /> Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Vacantes', href: '/vacancies', icon: Briefcase },
    { name: 'Candidatos', href: '/candidates', icon: Users },
    { name: 'Entrevistas', href: '/interviews', icon: Users },
    { name: 'Formularios', href: '/forms', icon: FileText },
    { name: 'Configuración', href: '/settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 z-[60] flex items-center justify-between px-4">
        <div className="flex items-center">
          <Sparkles className="w-6 h-6 text-violet-600 mr-2" />
          <span className="text-xl font-display font-bold text-slate-800 tracking-tight">
            Aura<span className="text-gradient-ai">ATS</span>
          </span>
        </div>
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
        >
          {isSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Sidebar Overlay (Mobile) */}
      {isSidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[70]"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-[80] flex flex-col glass-panel transition-all duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        ${isCollapsed ? 'lg:w-20 lg:m-4 lg:rounded-3xl lg:h-[calc(100vh-2rem)]' : 'w-72 lg:m-4 lg:rounded-3xl lg:h-[calc(100vh-2rem)]'}
        ${!isSidebarOpen && 'lg:left-0'}
        bg-white lg:bg-white/70
      `}>
        <div className={`p-6 flex items-center border-b border-white/20 ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
          <div className="flex items-center overflow-hidden">
            <div className="relative flex-shrink-0">
              <div className="absolute -inset-1 bg-gradient-ai rounded-full blur opacity-70 animate-pulse"></div>
              <div className="relative bg-white p-2 rounded-full">
                <Sparkles className="w-6 h-6 text-violet-600" />
              </div>
            </div>
            {!isCollapsed && (
              <span className="ml-3 text-xl font-display font-bold text-slate-800 tracking-tight whitespace-nowrap">
                Aura<span className="text-gradient-ai">ATS</span>
              </span>
            )}
          </div>
          
          {/* Collapse Toggle (Desktop) */}
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden lg:flex p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-all"
          >
            {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </button>
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href || 
                            (item.href !== '/' && location.pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setIsSidebarOpen(false)}
                className={`group flex items-center ${isCollapsed ? 'justify-center' : 'px-4'} py-3 text-sm font-medium rounded-2xl transition-all duration-300 ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20'
                    : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
                }`}
                title={isCollapsed ? item.name : ''}
              >
                <item.icon className={`flex-shrink-0 ${isCollapsed ? 'w-6 h-6' : 'w-5 h-5 mr-3'} transition-colors ${
                  isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-900'
                }`} />
                {!isCollapsed && item.name}
              </Link>
            );
          })}
          
          {/* External Link to Portal */}
          <div className="pt-4 mt-4 border-t border-slate-200/50 space-y-2">
            <AITestButton isCollapsed={isCollapsed} />
            <a
              href="/careers"
              target="_blank"
              rel="noopener noreferrer"
              className={`group flex items-center ${isCollapsed ? 'justify-center px-0' : 'px-4'} py-3 text-sm font-bold rounded-2xl transition-all duration-300 text-indigo-600 hover:bg-indigo-50`}
              title={isCollapsed ? 'Ver Portal Público' : ''}
            >
              <Briefcase className={`flex-shrink-0 ${isCollapsed ? 'w-6 h-6' : 'w-5 h-5 mr-3'} text-indigo-500 group-hover:text-indigo-600`} />
              {!isCollapsed && 'Ver Portal Público'}
            </a>
          </div>
        </nav>

        <div className={`p-4 border-t border-white/20 bg-white/30 ${isCollapsed ? 'flex justify-center' : ''}`}>
          <div className={`flex items-center ${isCollapsed ? '' : 'px-2 py-2'}`}>
            <div className="flex-shrink-0">
              <div className="h-10 w-10 rounded-full bg-gradient-ai flex items-center justify-center text-white font-bold shadow-md">
                {user.displayName?.charAt(0) || user.email?.charAt(0) || 'U'}
              </div>
            </div>
            {!isCollapsed && (
              <div className="ml-3 w-full overflow-hidden">
                <p className="text-sm font-medium text-slate-900 truncate">{user.displayName || 'Usuario'}</p>
                <button
                  onClick={handleLogout}
                  className="text-xs font-medium text-slate-500 hover:text-red-500 flex items-center mt-1 transition-colors"
                >
                  <LogOut className="w-3 h-3 mr-1" /> Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className={`
        flex-1 transition-all duration-300 ease-in-out flex flex-col
        ${isCollapsed ? 'lg:ml-28' : 'lg:ml-80'}
        min-h-screen
      `}>
        <CVWorker />
        <div className="p-4 md:p-8 pt-20 lg:pt-8 flex-1 flex flex-col">
          <WhatsAppStatusBanner />
          <div className="max-w-7xl mx-auto animate-fade-in w-full flex-1">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
