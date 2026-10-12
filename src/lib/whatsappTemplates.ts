/**
 * The default WhatsApp message of each automated stage — ONE copy, shared by the sender
 * (whatsapp.ts) and the template editor (Configuración), which used to keep two copies
 * "in sync" by hand.
 *
 * Written like a person from HR, not a broadcast: the company introduces itself in the
 * first line, one emoji at most, and every message invites a reply (incoming replies are
 * the strongest legitimacy signal a number can earn). Each line also offers alternatives
 * {a|b|c}, so no two candidates of a bulk move receive the same text — see
 * messageVariation.ts. Greetings are time-neutral on purpose: a queued message may go
 * out hours after it was written.
 */
export const DEFAULT_WA_TEMPLATES: Record<string, string> = {
  'Formulario etapa 2 enviado':
    // Greeting and "te saluda" are varied apart, so never "Saludos María, te saluda…".
    '{Hola|Buenas} {{primer_nombre}}, te {saluda|escribe} el equipo de reclutamiento de {{empresa}} {👋|🙂}\n\n' +
    '{Recibimos|Revisamos} tu {aplicación|solicitud} para {la vacante de|el puesto de} {{vacante}} y {nos gustó tu perfil|tu perfil nos llamó la atención}: {queremos avanzar contigo a la siguiente etapa|nos gustaría que sigas en el proceso}.\n\n' +
    'El {próximo|siguiente} paso es completar este formulario antes del {{fecha}}:\n{{link}}\n\n' +
    '{¿Contamos contigo?|¿Te animas a seguir?} {Respóndenos|Escríbenos} por aquí para saber que {recibiste|te llegó} este mensaje. Si prefieres no continuar en el proceso, también puedes decírnoslo.',
  'Convocado a entrevista':
    '{Hola|Saludos} {{primer_nombre}}, te escribimos de {{empresa}} {por el proceso de|sobre tu aplicación para} {{vacante}}.\n\n' +
    '{¡Buenas noticias!|¡Tenemos buenas noticias!} {Queremos invitarte|Nos gustaría invitarte} a una entrevista virtual:\n\n' +
    'Fecha: {{fecha}}\nHora: {{hora}}\nModalidad: Virtual ({{ubicacion}})\n\n' +
    '¿Te queda bien ese horario? {Respóndenos|Escríbenos} por aquí para confirmar; si no puedes ese día, lo coordinamos. {¡Gracias!|¡Saludos!}',
  'Entrevista presencial':
    '{Hola|Saludos|Buenas} {{primer_nombre}}, te escribimos de {{empresa}}. {Pasaste|Avanzaste} a la etapa final del proceso para {{vacante}} {🎉|👏}\n\n' +
    '{Queremos|Nos gustaría} conocerte en persona:\n\n' +
    'Fecha: {{fecha}}\nHora: {{hora}}\nLugar: {{ubicacion}}\n\n' +
    '¿Nos confirmas tu asistencia {respondiendo este mensaje|por aquí}? Si necesitas otro horario, {dinos y lo buscamos|avísanos y lo coordinamos}.',
  'Recordatorio de entrevista':
    '{Hola|Saludos|Buenas} {{primer_nombre}}, te escribimos de {{empresa}} {para recordarte|como recordatorio de} tu entrevista para {{vacante}}:\n\n' +
    'Fecha: {{fecha}}\nHora: {{hora}}\nLugar: {{ubicacion}}\n\n' +
    '{¿Nos confirmas que podrás asistir?|¿Nos confirmas tu asistencia?} {¡Te esperamos!|¡Nos vemos pronto!}',
  'Oferta':
    '{Hola|Saludos} {{primer_nombre}}, te escribimos de {{empresa}} con {una excelente noticia|muy buenas noticias}: {fuiste seleccionado(a)|quedaste seleccionado(a)} para el puesto de {{vacante}} 🎉\n\n' +
    '{Queremos|Nos gustaría} reunirnos contigo para revisar los detalles y formalizar el inicio:\n\n' +
    'Fecha: {{fecha}}\nHora: {{hora}}\nLugar: {{ubicacion}}\n\n' +
    '¿Nos confirmas por aquí? {¡Nos alegra mucho poder darte la bienvenida al equipo!|¡Será un gusto darte la bienvenida al equipo!}',
  'Descartado':
    '{Hola|Saludos} {{primer_nombre}}, te escribimos de {{empresa}}.\n\n' +
    '{Gracias por participar|Te agradecemos por participar} en nuestro proceso para la vacante de {{vacante}}. En esta ocasión {decidimos continuar con otros perfiles|seguiremos con otros perfiles}, pero valoramos de verdad el tiempo y el interés que dedicaste.\n\n' +
    '{Te deseamos muchos éxitos|Te deseamos lo mejor}, y ojalá coincidamos en una próxima oportunidad.',
  'Banco de talento':
    '{Hola|Saludos} {{primer_nombre}}, te escribimos de {{empresa}}.\n\n' +
    '{Gracias por tu excelente participación|Te agradecemos tu excelente participación} en el proceso para {{vacante}}. Esta vez el proceso concluyó con otro perfil, pero {tu desempeño nos gustó mucho|nos gustó mucho tu desempeño}.\n\n' +
    '{Nos encantaría|Nos gustaría} guardar tus datos en nuestro banco de talento para futuras oportunidades. ¿Nos autorizas? Responde "Sí, autorizo" y quedas dentro.',
};

/** Days the candidate gets to complete the stage-2 form when nobody set a deadline. */
export const STAGE2_DEADLINE_DAYS = 3;
