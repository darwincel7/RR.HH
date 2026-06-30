import React, { useState } from 'react';
import { Bot, Check, AlertCircle, Loader2 } from 'lucide-react';

export default function AITestButton({ isCollapsed }: { isCollapsed?: boolean }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const testAI = async () => {
    setStatus('loading');
    setMessage('');
    try {
      const res = await fetch('/api/test-ai');
      const data = await res.json();
      if (res.ok && data.success) {
        setStatus('success');
        setMessage(data.message);
      } else {
        setStatus('error');
        setMessage(data.error || 'Unknown error');
      }
    } catch (e: any) {
      setStatus('error');
      setMessage(e.message);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <button
        onClick={testAI}
        disabled={status === 'loading'}
        className={`group flex items-center w-full ${isCollapsed ? 'justify-center px-0' : 'px-4'} py-3 text-sm font-medium rounded-2xl transition-all duration-300 text-slate-600 hover:bg-violet-50 hover:text-violet-700`}
        title={isCollapsed ? 'Probar Conexión IA' : ''}
      >
        <Bot className={`flex-shrink-0 ${isCollapsed ? 'w-6 h-6' : 'w-5 h-5 mr-3'} ${status === 'loading' ? 'animate-pulse text-violet-500' : status === 'success' ? 'text-green-500' : status === 'error' ? 'text-red-500' : 'text-slate-400 group-hover:text-violet-600'}`} />
        {!isCollapsed && (
          <span className="flex-1 text-left">Probar IA</span>
        )}
        {!isCollapsed && status === 'loading' && <Loader2 className="w-4 h-4 animate-spin text-violet-500" />}
        {!isCollapsed && status === 'success' && <Check className="w-4 h-4 text-green-500" />}
        {!isCollapsed && status === 'error' && <AlertCircle className="w-4 h-4 text-red-500" />}
      </button>
      {!isCollapsed && message && (
        <div className={`mt-2 p-2 text-xs rounded-lg w-full ${status === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message}
        </div>
      )}
    </div>
  );
}
