import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../lib/firebase';
import { Loader2, CheckCircle, XCircle, RefreshCw, Save, MessageSquare, Building2, Image as ImageIcon, Upload } from 'lucide-react';

export default function WhatsAppSettings() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  
  const [companyName, setCompanyName] = useState('');
  const [companyLogoUrl, setCompanyLogoUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [templates, setTemplates] = useState({
    "Formulario etapa 2 enviado": "Hola {{nombre}} 👋\n\nRecientemente aplicaste para la vacante de {{vacante}} y hemos revisado tu perfil con mucho interés. ✅\n\nNos complace informarte que has sido preseleccionado(a) para avanzar a la siguiente etapa del proceso de entrevistas. 🎉\n\nSi deseas continuar, por favor completa el siguiente formulario:\n\n🔗 {{link}}\n\n🗓️ Fecha límite de respuesta: {{fecha}}\n\nAgradecemos tu interés y tu tiempo. ¡Estamos emocionados de conocerte mejor y descubrir si esta oportunidad es para ti! 🙌",
    "Convocado a entrevista": "🎉 ¡Felicitaciones {{nombre}}!\n\nHas sido preseleccionado(a) para avanzar a la siguiente etapa del proceso para el puesto de {{vacante}}.\n\nNos encantaría coordinar una entrevista virtual contigo para conocerte mejor.\n\n🗓️ Fecha: {{fecha}}\n🕒 Hora: {{hora}}\n📍 Modalidad: Virtual ({{ubicacion}})\n\nPor favor, responde a este mensaje para confirmar tu disponibilidad ✅\n\n¡Gracias por tu interés y entusiasmo!\n\nSaludos.",
    "Entrevista presencial": "🎉 ¡Felicidades, {{nombre}}!\n\nHas sido seleccionado/a para avanzar a la etapa final del proceso para el puesto de {{vacante}} 👏\n\nNos encantaría coordinar una entrevista presencial contigo para conocerte mejor.\n\n🗓️ Fecha: {{fecha}}\n🕒 Hora: {{hora}}\n📍 Modalidad: Presencial ({{ubicacion}})\n\nPor favor, responde a este mensaje para confirmar tu disponibilidad ✅\n\n¡Gracias por tu interés y entusiasmo!\n\nSaludos.",
    "Oferta": "🎉 ¡Felicitaciones, {{nombre}}!\n\nHas sido seleccionado/a para incorporarte a nuestro equipo en el puesto de {{vacante}} 👏✨\n\nQueremos coordinar una reunión presencial para revisar detalles y formalizar el acuerdo de inicio laboral.\n\n🗓️ Fecha: {{fecha}}\n🕒 Hora: {{hora}}\n📍 Lugar: {{ubicacion}}\n\nPor favor, confirma tu asistencia respondiendo a este mensaje ✅\n\n¡Estamos muy emocionados por tenerte en nuestro equipo! 🚀",
    "Descartado": "Hola {{nombre}} 👋,\n\nGracias por participar en nuestro proceso para la vacante de {{vacante}}. 🙏\n\nTras revisar todos los perfiles, hemos decidido continuar con otros candidatos en esta etapa. Agradecemos tu tiempo y el interés que mostraste. 🌟\n\n¡Te deseamos muchos éxitos!",
    "Banco de talento": "Hola {{nombre}} 👋\n\nQueremos agradecerte sinceramente por tu tiempo, disposición y la excelente participación que tuviste en la última etapa del proceso para el puesto de {{vacante}} 🙌\n\nEn esta ocasión, el proceso ha concluido con la selección de otro perfil, pero valoramos mucho tus capacidades y el potencial que demostraste.\n\n📌 Con tu permiso, nos gustaría conservar tus datos en nuestra base de talento para considerarte en futuras oportunidades que se alineen con tu perfil.\n\n¿Estarías de acuerdo? Solo debes responder “Sí, autorizo” ✅\n\n¡Gracias nuevamente por tu interés en formar parte de nuestro equipo!\n\nTe deseamos muchos éxitos en tus próximos pasos 🚀\n\nSaludos cordiales."
  });

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/whatsapp/status');
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        const data = await res.json();
        setStatus(data);
      } else {
        throw new Error("Received non-JSON response");
      }
    } catch (error) {
      console.error("Error fetching WhatsApp status:", error);
      setStatus({ status: 'disconnected', qr: null });
    }
  };

  const fetchSettings = async () => {
    try {
      // Fetch WhatsApp templates
      const docRef = doc(db, 'settings', 'whatsapp_templates');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists() && docSnap.data().templates) {
        setTemplates({ ...templates, ...docSnap.data().templates });
      }
      
      // Fetch Company Profile
      const companyRef = doc(db, 'settings', 'company');
      const companySnap = await getDoc(companyRef);
      if (companySnap.exists()) {
        setCompanyName(companySnap.data().name || '');
        setCompanyLogoUrl(companySnap.data().logoUrl || '');
      }
    } catch (error) {
      console.error("Error fetching settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleReconnect = async () => {
    try {
      setStatus({ status: 'disconnected', qr: null });
      await fetch('/api/whatsapp/reconnect', { method: 'POST' });
      fetchStatus();
    } catch (error) {
      console.error("Error reconnecting:", error);
    }
  };

  const handleLogout = async () => {
    if (!window.confirm("¿Seguro que deseas cerrar la sesión de WhatsApp? Tendrás que volver a escanear el código QR.")) return;
    try {
      setStatus({ status: 'disconnected', qr: null });
      await fetch('/api/whatsapp/logout', { method: 'POST' });
      fetchStatus();
    } catch (error) {
      console.error("Error logging out:", error);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000); // Poll every 5s
    return () => clearInterval(interval);
  }, []);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (limit to 1MB to fit in Firestore document)
    if (file.size > 1024 * 1024) {
      alert("El logo es demasiado grande. Por favor, sube una imagen de menos de 1MB.");
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    try {
      setUploadingLogo(true);
      
      // Convert to Base64
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setCompanyLogoUrl(base64String);
        setUploadingLogo(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      };
      reader.onerror = () => {
        throw new Error("Failed to read file");
      };
      reader.readAsDataURL(file);
      
    } catch (error) {
      console.error("Error uploading logo:", error);
      alert("Error al procesar el logo. Por favor, inténtalo de nuevo.");
      setUploadingLogo(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setSuccess(false);
    try {
      // Save templates
      await setDoc(doc(db, 'settings', 'whatsapp_templates'), { templates }, { merge: true });
      
      // Save company profile
      await setDoc(doc(db, 'settings', 'company'), { 
        name: companyName,
        logoUrl: companyLogoUrl
      }, { merge: true });
      
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("Error al guardar la configuración");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Configuración General</h1>
          <p className="text-slate-500">Gestiona el perfil de tu empresa y la conexión de WhatsApp.</p>
        </div>
        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className="flex items-center px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-sm"
        >
          {saving ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
          Guardar Cambios
        </button>
      </div>
      
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl flex items-center">
          <CheckCircle className="w-5 h-5 mr-2" />
          Configuración guardada correctamente.
        </div>
      )}

      {/* Company Profile */}
      <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-6">
        <div className="flex items-center mb-6">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg mr-3">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">Perfil de la Empresa (Branding)</h2>
            <p className="text-sm text-slate-500">Esta información será visible para los candidatos en el portal de empleo.</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Nombre de la Empresa</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Ej. TechCorp Solutions"
              className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">URL del Logo (Opcional)</label>
            <div className="flex flex-col space-y-3">
              <div className="flex items-center">
                <div className="relative flex-1">
                  <ImageIcon className="w-5 h-5 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={companyLogoUrl}
                    onChange={(e) => setCompanyLogoUrl(e.target.value)}
                    placeholder="https://ejemplo.com/logo.png"
                    className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                  />
                </div>
                {companyLogoUrl && (
                  <div className="ml-4 w-12 h-12 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center flex-shrink-0">
                    <img src={companyLogoUrl} alt="Logo" className="max-w-full max-h-full object-contain" onError={(e) => (e.currentTarget.style.display = 'none')} />
                  </div>
                )}
              </div>
              <div className="flex items-center">
                <span className="text-sm text-slate-500 mr-3">O sube un archivo:</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  ref={fileInputRef}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingLogo}
                  className="flex items-center px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {uploadingLogo ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                  {uploadingLogo ? 'Subiendo...' : 'Subir Logo'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Connection Status */}
      <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Estado de la conexión</h2>
            <p className="text-sm text-slate-500">Conecta tu cuenta para enviar mensajes automáticos.</p>
          </div>
          <div className="flex items-center">
            {status?.status === 'connected' ? (
              <span className="flex items-center text-green-600 font-bold bg-green-50 px-3 py-1 rounded-full text-sm">
                <CheckCircle className="w-4 h-4 mr-2" /> Conectado
              </span>
            ) : status?.status === 'qr' ? (
              <span className="flex items-center text-yellow-600 font-bold bg-yellow-50 px-3 py-1 rounded-full text-sm">
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Esperando escaneo
              </span>
            ) : (
              <span className="flex items-center text-red-600 font-bold bg-red-50 px-3 py-1 rounded-full text-sm">
                <XCircle className="w-4 h-4 mr-2" /> Desconectado
              </span>
            )}
          </div>
        </div>

        {status?.status === 'qr' && status.qr && (
          <div className="flex flex-col items-center p-8 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
            <p className="mb-4 text-sm font-bold text-slate-700">Escanea este código con tu WhatsApp:</p>
            <img src={status.qr} alt="WhatsApp QR Code" className="w-64 h-64 shadow-lg rounded-xl" />
            <p className="mt-6 text-xs text-slate-500 text-center max-w-xs font-medium">
              Abre WhatsApp en tu teléfono {'>'} Dispositivos vinculados {'>'} Vincular un dispositivo.
            </p>
          </div>
        )}

        {status?.status === 'connected' && (
          <div className="bg-green-50 border border-green-100 p-4 rounded-xl flex items-start justify-between">
            <div className="flex items-start">
              <CheckCircle className="text-green-500 mt-0.5 mr-3 flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-green-800">¡Todo listo!</p>
                <p className="text-sm text-green-700 mt-1 font-medium">
                  La aplicación está vinculada a tu WhatsApp. Ya puedes enviar mensajes desde los perfiles de los candidatos.
                </p>
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="ml-4 px-4 py-2 border border-red-200 text-red-600 bg-white rounded-lg hover:bg-red-50 text-sm font-medium transition-colors whitespace-nowrap"
            >
              Cerrar Sesión
            </button>
          </div>
        )}

        {status?.status === 'disconnected' && !status.qr && (
          <div className="text-center p-8">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600 mb-4" />
            <p className="text-slate-600 font-medium mb-4">La conexión de WhatsApp está suspendida o en conflicto.</p>
            <button 
              onClick={handleReconnect}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Forzar Reconexión
            </button>
          </div>
        )}
      </div>

      {/* Templates */}
      <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <div className="flex items-center">
            <MessageSquare className="w-5 h-5 text-green-600 mr-2" />
            <h2 className="text-lg font-bold text-slate-800">Plantillas por Etapa</h2>
          </div>
        </div>

        {success && (
          <div className="bg-green-50 text-green-700 p-4 border-b border-green-100 flex items-center text-sm font-bold">
            <CheckCircle className="w-4 h-4 mr-2" />
            Plantillas guardadas exitosamente.
          </div>
        )}

        <div className="p-6 space-y-6">
          <div className="bg-blue-50 border border-blue-100 p-4 rounded-lg">
            <h3 className="text-sm font-bold text-blue-900 mb-2">Variables dinámicas disponibles:</h3>
            <div className="flex flex-wrap gap-2">
              {['{{nombre}}', '{{vacante}}', '{{link}}', '{{fecha}}', '{{hora}}', '{{ubicacion}}'].map(v => (
                <span key={v} className="px-2 py-1 bg-white border border-blue-200 text-blue-700 text-xs font-mono rounded shadow-sm">{v}</span>
              ))}
            </div>
          </div>

          {Object.entries(templates).map(([stage, template]) => (
            <div key={stage}>
              <label className="block text-sm font-bold text-slate-700 mb-2">{stage}</label>
              <textarea
                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-sm"
                rows={3}
                value={template}
                onChange={e => setTemplates({...templates, [stage]: e.target.value})}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
