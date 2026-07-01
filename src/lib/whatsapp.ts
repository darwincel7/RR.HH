import { doc, getDoc, addDoc, collection, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { sendEmail, getEmailTemplate } from './email';
import { apiFetch } from './api';

export async function sendWhatsAppAutomation(
  phone: string,
  stage: string,
  variables: { nombre: string; vacante?: string; link?: string; fecha?: string; hora?: string; ubicacion?: string; email?: string }
) {
  try {
    // Fetch templates
    const docRef = doc(db, 'settings', 'whatsapp_templates');
    const docSnap = await getDoc(docRef);
    
    let template = "";
    if (docSnap.exists() && docSnap.data().templates && docSnap.data().templates[stage]) {
      template = docSnap.data().templates[stage];
    } else {
      // Fallbacks if not configured
      switch (stage) {
        case "Formulario etapa 2 enviado":
          template = "Hola {{nombre}} 👋\n\nRecientemente aplicaste para la vacante de {{vacante}} y hemos revisado tu perfil con mucho interés. ✅\n\nNos complace informarte que has sido preseleccionado(a) para avanzar a la siguiente etapa del proceso de entrevistas. 🎉\n\nSi deseas continuar, por favor completa el siguiente formulario:\n\n🔗 {{link}}\n\n🗓️ Fecha límite de respuesta: {{fecha}}\n\nAgradecemos tu interés y tu tiempo. ¡Estamos emocionados de conocerte mejor y descubrir si esta oportunidad es para ti! 🙌";
          break;
        case "Convocado a entrevista":
          template = "🎉 ¡Felicitaciones {{nombre}}!\n\nHas sido preseleccionado(a) para avanzar a la siguiente etapa del proceso para el puesto de {{vacante}}.\n\nNos encantaría coordinar una entrevista virtual contigo para conocerte mejor.\n\n🗓️ Fecha: {{fecha}}\n🕒 Hora: {{hora}}\n📍 Modalidad: Virtual ({{ubicacion}})\n\nPor favor, responde a este mensaje para confirmar tu disponibilidad ✅\n\n¡Gracias por tu interés y entusiasmo!\n\nSaludos.";
          break;
        case "Entrevista presencial":
          template = "🎉 ¡Felicidades, {{nombre}}!\n\nHas sido seleccionado/a para avanzar a la etapa final del proceso para el puesto de {{vacante}} 👏\n\nNos encantaría coordinar una entrevista presencial contigo para conocerte mejor.\n\n🗓️ Fecha: {{fecha}}\n🕒 Hora: {{hora}}\n📍 Modalidad: Presencial ({{ubicacion}})\n\nPor favor, responde a este mensaje para confirmar tu disponibilidad ✅\n\n¡Gracias por tu interés y entusiasmo!\n\nSaludos.";
          break;
        case "Recordatorio de entrevista":
          template = "⏰ Recordatorio de entrevista\n\nHola {{nombre}} 👋\n\nTe recordamos tu entrevista para el puesto de {{vacante}}.\n\n🗓️ Fecha: {{fecha}}\n🕒 Hora: {{hora}}\n📍 Lugar: {{ubicacion}}\n\nPor favor, confirma tu asistencia respondiendo a este mensaje ✅. ¡Te esperamos!";
          break;
        case "Oferta":
          template = "🎉 ¡Felicitaciones, {{nombre}}!\n\nHas sido seleccionado/a para incorporarte a nuestro equipo en el puesto de {{vacante}} 👏✨\n\nQueremos coordinar una reunión presencial para revisar detalles y formalizar el acuerdo de inicio laboral.\n\n🗓️ Fecha: {{fecha}}\n🕒 Hora: {{hora}}\n📍 Lugar: {{ubicacion}}\n\nPor favor, confirma tu asistencia respondiendo a este mensaje ✅\n\n¡Estamos muy emocionados por tenerte en nuestro equipo! 🚀";
          break;
        // "Contratado" intentionally has NO template: hiring is handled in person,
        // so no automatic WhatsApp is sent when a candidate is marked as hired.
        case "Descartado":
          template = "Hola {{nombre}} 👋,\n\nGracias por participar en nuestro proceso para la vacante de {{vacante}}. 🙏\n\nTras revisar todos los perfiles, hemos decidido continuar con otros candidatos en esta etapa. Agradecemos tu tiempo y el interés que mostraste. 🌟\n\n¡Te deseamos muchos éxitos!";
          break;
        case "Banco de talento":
          template = "Hola {{nombre}} 👋\n\nQueremos agradecerte sinceramente por tu tiempo, disposición y la excelente participación que tuviste en la última etapa del proceso para el puesto de {{vacante}} 🙌\n\nEn esta ocasión, el proceso ha concluido con la selección de otro perfil, pero valoramos mucho tus capacidades y el potencial que demostraste.\n\n📌 Con tu permiso, nos gustaría conservar tus datos en nuestra base de talento para considerarte en futuras oportunidades que se alineen con tu perfil.\n\n¿Estarías de acuerdo? Solo debes responder “Sí, autorizo” ✅\n\n¡Gracias nuevamente por tu interés en formar parte de nuestro equipo!\n\nTe deseamos muchos éxitos en tus próximos pasos 🚀\n\nSaludos cordiales.";
          break;
      }
    }

    if (!template) return false;

    // Replace variables
    let message = template.replace(/{{nombre}}/g, variables.nombre || '');
    message = message.replace(/{{vacante}}/g, variables.vacante || 'la vacante');
    message = message.replace(/{{link}}/g, variables.link || '');
    message = message.replace(/{{fecha}}/g, variables.fecha || '');
    message = message.replace(/{{hora}}/g, variables.hora || '');
    message = message.replace(/{{ubicacion}}/g, variables.ubicacion || '');

    // Send Email Automation if email is provided
    if (variables.email) {
      try {
        const companyRef = doc(db, 'settings', 'company');
        const companySnap = await getDoc(companyRef);
        const companyName = companySnap.exists() ? companySnap.data().name : 'Nuestra Empresa';
        const companyLogoUrl = companySnap.exists() ? companySnap.data().logoUrl : '';

        const emailHtml = getEmailTemplate(
          `Actualización de tu proceso: ${stage}`,
          message,
          companyLogoUrl
        );
        await sendEmail(variables.email, `Actualización de tu proceso - ${companyName}`, emailHtml);
      } catch (emailError) {
        console.error("Error sending email automation:", emailError);
      }
    }

    // Send message via API
    const res = await apiFetch('/api/automations/stage-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message })
    });

    let data;
    try {
      data = await res.json();
    } catch (parseError) {
      console.error("Failed to parse API response. Status:", res.status);
      return false;
    }
    
    if (data.success && data.messageSent) {
      // Find candidate ID by phone to save the message
      const candidatesRef = collection(db, 'candidates');
      const q = query(candidatesRef, where('phone', '==', phone));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const candidateId = querySnapshot.docs[0].id;
        await addDoc(collection(db, 'whatsapp_messages'), {
          candidateId,
          text: message,
          sentAt: serverTimestamp(),
          direction: 'outbound',
          isAutomated: true,
          stage
        });
      }
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error sending WhatsApp automation:", error);
    return false;
  }
}
