import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { signInAnonymously } from 'firebase/auth';
import { db, auth, storage } from '../lib/firebase';
import { Upload, CheckCircle, Loader2, MapPin, Clock, ArrowLeft, Building2 } from 'lucide-react';
import { sendApplicationConfirmation } from '../lib/email';

export default function Apply() {
  const { vacancyId } = useParams();
  const navigate = useNavigate();
  const [vacancy, setVacancy] = useState<any>(null);
  const [company, setCompany] = useState({ name: 'AuraATS', logoUrl: '' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [step, setStep] = useState(1);
  const [progress, setProgress] = useState(0);
  
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (submitting) {
      setProgress(0);
      timer = setInterval(() => {
        setProgress((oldProgress) => {
          if (oldProgress >= 95) {
            clearInterval(timer);
            return 95;
          }
          const diff = Math.floor(Math.random() * 5) + 3; 
          const finalDiff = oldProgress > 80 ? Math.floor(Math.random() * 2) + 1 : diff;
          return Math.min(oldProgress + finalDiff, 95);
        });
      }, 800);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [submitting]);

  useEffect(() => {
    async function fetchData() {
      if (!vacancyId) return;
      try {
        // Fetch Company Branding
        const companyRef = doc(db, 'settings', 'company');
        const companySnap = await getDoc(companyRef);
        if (companySnap.exists()) {
          setCompany({
            name: companySnap.data().name || 'AuraATS',
            logoUrl: companySnap.data().logoUrl || ''
          });
        }

        // Fetch Vacancy
        const docRef = doc(db, 'vacancies', vacancyId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data().active) {
          setVacancy(docSnap.data());
        } else {
          setErrorMsg('La vacante no existe o ya no está activa.');
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        setErrorMsg('Error al cargar la vacante.');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [vacancyId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp'];
      
      if (!allowedTypes.includes(selectedFile.type)) {
        setErrorMsg('Por favor, sube un archivo PDF, Word (doc/docx) o Imagen (jpg/png).');
        return;
      }
      if (selectedFile.size > 20 * 1024 * 1024) {
        setErrorMsg('El archivo no debe superar los 20MB.');
        return;
      }
      setFile(selectedFile);
      setErrorMsg('');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const selectedFile = e.dataTransfer.files[0];
      const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp'];
      
      if (!allowedTypes.includes(selectedFile.type)) {
        setErrorMsg('Por favor, sube un archivo PDF, Word (doc/docx) o Imagen (jpg/png).');
        return;
      }
      if (selectedFile.size > 20 * 1024 * 1024) {
        setErrorMsg('El archivo no debe superar los 20MB.');
        return;
      }
      setFile(selectedFile);
      setErrorMsg('');
    }
  };

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone) {
      setErrorMsg('Por favor completa tu nombre y teléfono.');
      return;
    }
    setErrorMsg('');
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !vacancyId || !name || !phone || !email || !city) {
      setErrorMsg('Por favor completa todos los campos y sube tu CV.');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    try {
      // 1. Sign in anonymously to get a UID for Firestore rules
      const userCredential = await signInAnonymously(auth);
      const candidateId = userCredential.user.uid;

      // 2. Upload file to Firebase Storage
      const fileExt = file.name.split('.').pop();
      // Store under a per-owner folder so Storage rules can restrict reads to the
      // uploader (candidates can't read each other's CVs).
      const storageRef = ref(storage, `cvs/${candidateId}/${vacancyId}_${Date.now()}.${fileExt}`);
      await uploadBytes(storageRef, file);
      const cvUrl = await getDownloadURL(storageRef);

      // 3. Save Candidate Profile (Basic Info, AI will process later)
      await setDoc(doc(db, 'candidates', candidateId), {
        fullName: name,
        email: email,
        phone: phone,
        city: city,
        cvUrl,
        cvFileType: file.type,
        aiStatus: 'pending', // Indicates it needs AI processing later
        createdAt: serverTimestamp()
      });

      // 4. Save Application
      const applicationId = `${candidateId}_${vacancyId}`;
      await setDoc(doc(db, 'applications', applicationId), {
        candidateId,
        vacancyId,
        candidateName: name,
        stage: 'Nuevo',
        cvUrl,
        cvFileType: file.type,
        submittedAt: serverTimestamp(),
        lastStageUpdate: serverTimestamp()
      });

      // 5. Send Confirmation Email (server-side template; best-effort)
      try {
        await sendApplicationConfirmation(email, name, vacancy?.title || 'nuestra empresa');
      } catch (emailError) {
        console.error("Error sending confirmation email:", emailError);
      }

      setProgress(100);
      setTimeout(() => {
        setSuccess(true);
        setSubmitting(false);
      }, 600);
    } catch (error: any) {
      console.error("Error submitting application:", error);
      setErrorMsg(`Ocurrió un error: ${error.message || 'Error desconocido al enviar la postulación.'}`);
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-white"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;

  if (errorMsg && !vacancy) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center border border-slate-100">
          <p className="text-red-600 font-medium">{errorMsg}</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center border border-slate-100">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">¡Postulación enviada!</h2>
          <p className="text-slate-600 mb-4">
            Hemos recibido tu información para la vacante de <strong>{vacancy?.title}</strong>. 
          </p>
          <div className="bg-blue-50 p-4 rounded-lg text-sm text-blue-800 text-left">
            <p className="font-bold mb-2">¿Qué sigue ahora?</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Nuestro equipo revisará tu perfil detalladamente.</li>
              <li>Si tu perfil se ajusta a lo que buscamos, te contactaremos vía <strong>WhatsApp</strong> o correo electrónico para coordinar los siguientes pasos.</li>
              <li>Mantente atento a tus mensajes.</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-3xl mx-auto">
        
        {/* Company Header */}
        <div className="flex items-center justify-center mb-10 pb-6 border-b border-slate-100">
          {company.logoUrl ? (
            <img src={company.logoUrl} alt={company.name} className="h-12 max-w-[200px] object-contain" />
          ) : (
            <div className="flex items-center text-2xl font-display font-bold text-slate-800">
              <Building2 className="w-8 h-8 text-indigo-600 mr-3" />
              {company.name}
            </div>
          )}
        </div>

        {/* Vacancy Details Header */}
        <div className="mb-10">
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight mb-4 uppercase">
            OPORTUNIDAD DE EMPLEO COMO {vacancy?.title}
          </h1>
          
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 text-sm font-medium text-slate-600 mb-8">
            <div className="flex items-center">
              <MapPin className="w-4 h-4 mr-1.5 text-red-500" />
              Ubicación: {vacancy?.location || 'Remoto / Presencial'}
            </div>
            <div className="flex items-center">
              <Clock className="w-4 h-4 mr-1.5 text-slate-400" />
              Horario: {vacancy?.schedule || '9:00AM A 6:00PM - Lunes a Viernes'}
            </div>
          </div>

          {step === 1 && (
            <div className="space-y-6 text-sm text-slate-700">
              <div>
                <h3 className="font-bold text-slate-900 mb-2">Funciones principales:</h3>
                <ul className="list-disc pl-5 space-y-1 text-slate-600">
                  {(vacancy?.functions || 'Atender consultas y requerimientos del área.\nGestionar procesos internos y seguimiento de tareas.\nCumplir metas y reportar resultados.').split('\n').map((item: string, i: number) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
              
              <div>
                <h3 className="font-bold text-slate-900 mb-2">Requisitos:</h3>
                <ul className="list-disc pl-5 space-y-1 text-slate-600">
                  {(vacancy?.requirements || 'Experiencia previa en el área (preferible).\nManejo básico de herramientas digitales.\nExcelente comunicación y capacidad de resolución.\nResponsable, puntual y orientado a resultados.').split('\n').map((item: string, i: number) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 mb-2">Ofrecemos:</h3>
                <ul className="list-disc pl-5 space-y-1 text-slate-600">
                  {(vacancy?.offers || 'Sueldo base competitivo.\nCapacitación inicial y continua.\nOportunidad de crecimiento dentro de la empresa.').split('\n').map((item: string, i: number) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Form Section */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 shadow-sm">
          {errorMsg && (
            <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg text-sm border border-red-100">
              {errorMsg}
            </div>
          )}

          {step === 1 ? (
            <form onSubmit={handleNextStep} className="space-y-6">
              <div>
                <label htmlFor="name" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  NOMBRE COMPLETO <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>

              <div>
                <label htmlFor="phone" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  NUMERO DE WHATSAPP <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  id="phone"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  className="w-full py-4 px-6 rounded-lg text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900 transition-colors uppercase tracking-wider"
                >
                  Continuar
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6 animate-fade-in">
              <button 
                type="button" 
                onClick={() => setStep(1)}
                className="flex items-center text-sm font-medium text-slate-500 hover:text-slate-800 mb-6 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 mr-1" /> Volver
              </button>

              <div>
                <label htmlFor="email" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  CORREO ELECTRONICO <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  id="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>

              <div>
                <label htmlFor="city" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  DONDE VIVES? <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="city"
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  SUBE TU CURRICULUM AQUI <span className="text-red-500">*</span>
                </label>
                
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  className="mt-1 flex flex-col items-center justify-center px-6 py-12 border-2 border-slate-300 border-dashed rounded-xl hover:border-blue-500 hover:bg-blue-50/50 transition-all cursor-pointer group"
                >
                  <Upload className="mx-auto h-10 w-10 text-slate-400 group-hover:text-blue-500 transition-colors mb-3" />
                  <div className="flex text-sm text-slate-600 justify-center">
                    <span className="font-medium text-blue-600 group-hover:text-blue-700">
                      Suelta los archivos aquí o busca
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">PDF, Word, JPG, PNG hasta 20MB</p>
                  
                  <input
                    ref={fileInputRef}
                    id="file-upload"
                    name="file-upload"
                    type="file"
                    accept=".pdf,.doc,.docx,image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={handleFileChange}
                  />
                </div>
                
                {file && (
                  <div className="mt-3 p-3 bg-green-50 border border-green-100 rounded-lg flex items-center text-sm text-green-700 font-medium">
                    <CheckCircle className="w-4 h-4 mr-2 text-green-500" />
                    {file.name}
                  </div>
                )}
              </div>

              <div className="pt-4">
                {submitting ? (
                  <div className="w-full flex flex-col items-center justify-center p-6 bg-blue-50 rounded-lg border border-blue-100 text-center">
                    <Loader2 className="w-10 h-10 mb-4 animate-spin text-blue-600" />
                    <h3 className="text-lg font-bold text-blue-900 mb-2 uppercase tracking-wide">
                      Analizando y procesando tu currículum
                    </h3>
                    <p className="text-sm text-blue-600 font-medium">
                      Esto puede tardar de 1 a 2 minutos.
                    </p>
                    <div className="w-full bg-blue-200 rounded-full h-2.5 mt-4 overflow-hidden">
                      <div 
                        className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out relative"
                        style={{ width: `${Math.max(5, progress)}%` }}
                      >
                        <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                      </div>
                    </div>
                    <p className="text-xs text-blue-500 mt-2 font-semibold">{Math.round(progress)}% completado</p>
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={!file || !email || !city}
                    className="w-full flex justify-center py-4 px-6 border border-transparent rounded-lg shadow-sm text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors uppercase tracking-wider"
                  >
                    Enviar Postulación
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
