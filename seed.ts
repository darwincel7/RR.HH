import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const newVacancy = {
  title: "Atención al Cliente / Soporte Ventas",
  code: "V-001",
  active: true,
  createdAt: new Date(),
  location: "Presencial / BANI",
  schedule: "9:00AM A 7:00PM - 5 dias a la semana (horario rotativo)",
  functions: "Atender consultas y requerimientos del área de ventas.\nGestionar procesos internos y seguimiento de tareas.\nSeguimientos de clientes, para maximizar ventas.\nCumplir metas y reportar resultados.\n\nRequisitos:\nExperiencia previa o no en el área (preferible).\nManejo básico de herramientas digitales.\nExcelente comunicación y capacidad de resolución.\nResponsable, puntual y orientado a resultados.\nIndispensable la excelente ortografía.\n\nOfrecemos:\nSueldo competitivo de $20.000 a $30.000\nCapacitación inicial y continua.\nOportunidad de crecimiento dentro de la empresa.\nCrecimiento profesional con capacitaciones externas constantes."
};

async function seed() {
  await addDoc(collection(db, 'vacancies'), newVacancy);
  console.log("Vacancy added!");
  process.exit(0);
}
seed().catch(console.error);
