import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Briefcase, Users, UserCheck, Clock, ArrowRight, TrendingUp, Activity, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { motion } from 'motion/react';

// Vibrant Premium Palette
const COLORS = ['#6366f1', '#ec4899', '#0ea5e9', '#14b8a6', '#f59e0b', '#8b5cf6'];

export default function Dashboard() {
  const { userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    activeVacancies: 0,
    totalCandidates: 0,
    inInterview: 0,
    hired: 0
  });
  const [recentApps, setRecentApps] = useState<any[]>([]);
  const [stageData, setStageData] = useState<any[]>([]);
  const [vacancyData, setVacancyData] = useState<any[]>([]);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        // Fetch Vacancies
        const vacSnap = await getDocs(collection(db, 'vacancies'));
        const activeVacancies = vacSnap.docs.filter(d => d.data().active === true).length;
        
        const vacMap = new Map();
        vacSnap.docs.forEach(d => {
          vacMap.set(d.id, d.data().title);
        });

        // Fetch Applications
        const appSnap = await getDocs(collection(db, 'applications'));
        const apps = appSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        
        let inInterview = 0;
        let hired = 0;
        const stageCounts: Record<string, number> = {};
        const vacancyCounts: Record<string, number> = {};

        apps.forEach(app => {
          // Stage counts
          if (app.stage === 'Convocado a entrevista' || app.stage === 'Entrevista presencial') inInterview++;
          if (app.stage === 'Contratado') hired++;
          
          stageCounts[app.stage] = (stageCounts[app.stage] || 0) + 1;
          
          // Vacancy counts
          const vTitle = vacMap.get(app.vacancyId) || 'Desconocida';
          vacancyCounts[vTitle] = (vacancyCounts[vTitle] || 0) + 1;
        });

        const formattedStageData = Object.keys(stageCounts).map(key => ({
          name: key,
          value: stageCounts[key]
        })).sort((a, b) => b.value - a.value);

        const formattedVacancyData = Object.keys(vacancyCounts).map(key => ({
          name: key.length > 15 ? key.substring(0, 15) + '...' : key,
          candidatos: vacancyCounts[key]
        })).sort((a, b) => b.candidatos - a.candidatos).slice(0, 5); // Top 5

        // Fetch Recent Applications
        const recentQ = query(collection(db, 'applications'), orderBy('appliedAt', 'desc'), limit(5));
        const recentSnap = await getDocs(recentQ);
        const recent = recentSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            vacancyTitle: vacMap.get(data.vacancyId) || 'Vacante'
          };
        });

        setMetrics({
          activeVacancies,
          totalCandidates: apps.length,
          inInterview,
          hired
        });
        setStageData(formattedStageData);
        setVacancyData(formattedVacancyData);
        setRecentApps(recent);
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Activity className="w-8 h-8 text-indigo-600 animate-pulse" />
      </div>
    );
  }

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
  };

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="max-w-[1400px] mx-auto space-y-8"
    >
      <motion.div variants={itemVariants} className="flex justify-between items-end border-b border-slate-200/60 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 mb-1 flex items-center">
            Dashboard Panel
            <Sparkles className="w-5 h-5 ml-3 text-indigo-500" />
          </h1>
          <p className="text-sm font-medium text-slate-500/80 uppercase tracking-widest">
            {userData?.name ? `Métricas en tiempo real / ${userData.name}` : 'Métricas en tiempo real'}
          </p>
        </div>
      </motion.div>

      {/* Metrics Cards - Vibrant Modern SaaS */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-indigo-50 flex flex-col justify-between min-h-[150px] relative overflow-hidden group hover:shadow-md transition-all">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all"></div>
          <div className="flex justify-between items-start relative z-10">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-indigo-600" />
            </div>
          </div>
          <div className="mt-5 relative z-10">
            <p className="text-4xl font-extrabold text-slate-900">{metrics.activeVacancies}</p>
            <p className="text-xs font-bold text-indigo-600/70 uppercase tracking-widest mt-1">Vacantes Activas</p>
          </div>
        </div>
        
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-blue-50 flex flex-col justify-between min-h-[150px] relative overflow-hidden group hover:shadow-md transition-all">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all"></div>
          <div className="flex justify-between items-start relative z-10">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
          </div>
          <div className="mt-5 relative z-10">
            <p className="text-4xl font-extrabold text-slate-900">{metrics.totalCandidates}</p>
            <p className="text-xs font-bold text-blue-600/70 uppercase tracking-widest mt-1">Total Candidatos</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-sm border border-amber-50 flex flex-col justify-between min-h-[150px] relative overflow-hidden group hover:shadow-md transition-all">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition-all"></div>
          <div className="flex justify-between items-start relative z-10">
             <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
          </div>
          <div className="mt-5 relative z-10">
            <p className="text-4xl font-extrabold text-slate-900">{metrics.inInterview}</p>
            <p className="text-xs font-bold text-amber-600/70 uppercase tracking-widest mt-1">En Entrevista</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-sm border border-emerald-50 flex flex-col justify-between min-h-[150px] relative overflow-hidden group hover:shadow-md transition-all">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all"></div>
          <div className="flex justify-between items-start relative z-10">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
              <UserCheck className="w-5 h-5 text-emerald-600" />
            </div>
          </div>
          <div className="mt-5 relative z-10">
            <p className="text-4xl font-extrabold text-slate-900">{metrics.hired}</p>
            <p className="text-xs font-bold text-emerald-600/70 uppercase tracking-widest mt-1">Contratados</p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Charts */}
        <motion.div variants={itemVariants} className="lg:col-span-2 space-y-6">
          
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest">
                Distribución de Candidatos (Top 5)
              </h2>
              <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-indigo-500" />
              </div>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={vacancyData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} />
                  <RechartsTooltip 
                    cursor={{ fill: 'rgba(99, 102, 241, 0.04)' }}
                    contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)', fontSize: '12px', fontWeight: 600 }}
                  />
                  <Bar dataKey="candidatos" fill="#6366f1" radius={[6, 6, 0, 0]} barSize={32}>
                    {vacancyData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-8">Funnel por Etapas</h2>
            <div className="flex flex-col md:flex-row items-center gap-8 h-72">
              <div className="h-full w-full md:w-1/2 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stageData}
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={100}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                      cornerRadius={4}
                    >
                      {stageData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1)', fontSize: '12px', fontWeight: 600 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center text in donut */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-3xl font-extrabold text-slate-900">{metrics.totalCandidates}</span>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Total</span>
                </div>
              </div>
              
              <div className="w-full md:w-1/2 flex flex-col justify-center space-y-4">
                {stageData.map((entry, index) => (
                  <div key={entry.name} className="flex items-center justify-between group">
                    <div className="flex items-center text-xs text-slate-600 font-semibold group-hover:text-slate-900 transition-colors">
                      <span className="w-2.5 h-2.5 rounded-full mr-3 border border-white shadow-sm" style={{ backgroundColor: COLORS[index % COLORS.length] }}></span>
                      {entry.name}
                    </div>
                    <span className="text-sm font-extrabold text-slate-900 bg-slate-50 px-2 py-0.5 rounded-md">{entry.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Recent Activity */}
        <motion.div variants={itemVariants} className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8 flex flex-col overflow-hidden">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest">Actividad Reciente</h2>
            <Link to="/vacancies" className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 uppercase tracking-widest transition-colors flex items-center bg-indigo-50 px-2 py-1 rounded-full">
              Ver todo <ArrowRight className="w-3 h-3 ml-1" />
            </Link>
          </div>
          
          <div className="flex-1 space-y-3">
            {recentApps.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full opacity-50 py-12">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Sin actividad</p>
                <p className="text-xs text-slate-400 mt-2 text-center">No hay candidatos recientes.</p>
              </div>
            ) : (
              recentApps.map(app => (
                <Link key={app.id} to={`/candidates/${app.candidateId}`} className="block group">
                  <div className="p-4 rounded-2xl border border-transparent bg-slate-50/50 hover:bg-white hover:border-indigo-100 hover:shadow-[0_4px_20px_-4px_rgba(99,102,241,0.1)] transition-all">
                    <div className="flex justify-between items-center mb-2">
                      <h3 className="font-bold text-sm text-slate-800 group-hover:text-indigo-600 transition-colors truncate pr-2">{app.candidateName}</h3>
                      <div className="flex items-center gap-2 flex-shrink-0">
                         {app.scoreSummary && (
                          <span className="text-[10px] font-black text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg">
                            {(app.scoreSummary * 20).toFixed(0)} PTS
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] font-medium text-slate-500 mb-3 truncate">{app.vacancyTitle}</p>
                    <div className="flex items-center">
                      <span className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-1.5 bg-white border border-slate-200 px-2 py-1 rounded-md">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                        {app.stage}
                      </span>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
