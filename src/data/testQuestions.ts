export type QuestionType = 'text' | 'textarea' | 'multiple_choice' | 'scale' | 'multiple_selection';

export interface Question {
  id: string;
  block: string;
  text: string;
  type: QuestionType;
  options?: string[];
}

export const masterTestQuestions: Question[] = [
  // Bloque A. Lógica, atención y memoria
  {
    id: 'A1',
    block: 'Bloque A. Lógica, atención y memoria',
    text: 'Si un cliente compra un artículo de RD$1,255 y paga con RD$2,000, ¿cuánto cambio debe recibir?',
    type: 'text'
  },
  {
    id: 'A2',
    block: 'Bloque A. Lógica, atención y memoria',
    text: 'Si una persona tarda 15 minutos en atender a un cliente y debe atender 4 clientes, ¿cuánto tiempo necesitaría en total?',
    type: 'text'
  },
  {
    id: 'A3',
    block: 'Bloque A. Lógica, atención y memoria',
    text: 'Ordena estas acciones de la más correcta a la menos correcta cuando no sabes una información: inventar, responder, verificar, preguntar.',
    type: 'text'
  },
  {
    id: 'A4',
    block: 'Bloque A. Lógica, atención y memoria',
    text: 'Completa la secuencia: 2, 4, 8, 16, __',
    type: 'text'
  },
  {
    id: 'A5',
    block: 'Bloque A. Lógica, atención y memoria',
    text: 'Completa la secuencia: lunes, miércoles, viernes, __',
    type: 'text'
  },
  {
    id: 'A6',
    block: 'Bloque A. Lógica, atención y memoria',
    text: 'Si todos los vendedores deben reportar sus ventas al final del día y Ana es vendedora, ¿qué debe hacer Ana?',
    type: 'multiple_choice',
    options: [
      'Reportar sus ventas al final del día',
      'Esperar a que le pregunten',
      'Reportar al día siguiente',
      'Vender mucho'
    ]
  },
  {
    id: 'A7',
    block: 'Bloque A. Lógica, atención y memoria',
    text: '¿Cuál palabra no pertenece al grupo? Cliente, proveedor, vendedor, supervisor, factura',
    type: 'multiple_choice',
    options: ['Cliente', 'Proveedor', 'Vendedor', 'Supervisor', 'Factura']
  },
  {
    id: 'A8',
    block: 'Bloque A. Lógica, atención y memoria',
    text: 'Lee y responde: "Un buen servicio implica escuchar, orientar y confirmar". ¿Cuál acción falta si una persona solo escucha y responde rápido sin confirmar?',
    type: 'text'
  },
  {
    id: 'A9',
    block: 'Bloque A. Lógica, atención y memoria',
    text: 'Si una caja abre a las 7:55 a. m. y un empleado llega 25 minutos tarde, ¿a qué hora llegó?',
    type: 'text'
  },
  {
    id: 'A10',
    block: 'Bloque A. Lógica, atención y memoria',
    text: 'Elige la opción más lógica: Si un equipo trabaja mejor con orden y seguimiento, entonces para mejorar los resultados conviene…',
    type: 'multiple_choice',
    options: [
      'Implementar orden y seguimiento',
      'Dejar que cada quien trabaje a su manera',
      'Contratar más personal',
      'Reducir las horas de trabajo'
    ]
  },
  {
    id: 'A11',
    block: 'Bloque A. Lógica, atención y memoria',
    text: 'Memoria breve. Paso previo de implementación: mostrar durante 8 segundos estas palabras: cliente, cambio, orden, llamada, factura. Luego preguntar: ¿Cuáles de estas palabras recuerdas haber visto?',
    type: 'multiple_selection',
    options: ['cliente', 'cambio', 'orden', 'llamada', 'factura', 'zapato', 'venta']
  },
  {
    id: 'A12',
    block: 'Bloque A. Lógica, atención y memoria',
    text: 'Atención visual o textual: identifica el número diferente en esta serie: 4848, 4848, 4884, 4848.',
    type: 'multiple_choice',
    options: ['4848 (primero)', '4848 (segundo)', '4884', '4848 (cuarto)']
  },

  // Bloque B. Juicio laboral y servicio
  {
    id: 'B13',
    block: 'Bloque B. Juicio laboral y servicio',
    text: 'Un cliente llega molesto porque siente que lo atendieron tarde. ¿Qué haces primero?',
    type: 'multiple_choice',
    options: [
      'Le explicas de inmediato que hay muchos clientes',
      'Le dices que se calme o lo calmas',
      'Lo escuchas, validas su molestia y buscas solución',
      'Llamas al encargado para que lo soluciones'
    ]
  },
  {
    id: 'B14',
    block: 'Bloque B. Juicio laboral y servicio',
    text: 'Si tu supervisor te corrige frente a otras personas, ¿cómo reaccionas normalmente?',
    type: 'multiple_choice',
    options: [
      'Lo confronto de inmediato porque no me gusta eso',
      'Mantengo la calma, tomo la corrección y luego aclaro si es necesario',
      'Me molesto y bajo el ánimo para el resto del día',
      'Lo ignoro por el momento, pero me quedo resentido'
    ]
  },
  {
    id: 'B15',
    block: 'Bloque B. Juicio laboral y servicio',
    text: 'No conoces bien una información que un cliente te pide. ¿Qué haces?',
    type: 'multiple_choice',
    options: [
      'Creas una respuesta',
      'Le dices que no sabes',
      'Verificas la información antes de responder',
      'Lo mandas donde otro compañero de trabajo'
    ]
  },
  {
    id: 'B16',
    block: 'Bloque B. Juicio laboral y servicio',
    text: 'Tienes mucho trabajo y entra un cliente indeciso pero amable. ¿Qué haces?',
    type: 'multiple_choice',
    options: [
      'Lo presionas para que decida rápido',
      'Lo atiendes con respeto y manejas el tiempo',
      'Lo dejas esperando para despues',
      'Te desesperas y vas a hacer tu trabajo'
    ]
  },
  {
    id: 'B17',
    block: 'Bloque B. Juicio laboral y servicio',
    text: 'Cometes un error en un proceso interno. ¿Qué haces?',
    type: 'multiple_choice',
    options: [
      'No dices nada de ello',
      'Esperas solo a ver si otro lo nota o no',
      'Lo informas y corriges sabiendo que tendra consecuencias',
      'Culpas al sistema, ya que aveces pasa'
    ]
  },
  {
    id: 'B18',
    block: 'Bloque B. Juicio laboral y servicio',
    text: 'La empresa tiene una política que no le gusta a un cliente. ¿Qué haces?',
    type: 'multiple_choice',
    options: [
      'Le sigues la corriente y criticas la política con el cliente',
      'no le haces caso a lo que dice y continuas',
      'La explicas con respeto y buscas una alternativa permitida',
      'Te saltas esa parte para evitar incomodar ese cliente'
    ]
  },
  {
    id: 'B19',
    block: 'Bloque B. Juicio laboral y servicio',
    text: 'Ves a un compañero tratando mal a un cliente. ¿Qué haces?',
    type: 'multiple_choice',
    options: [
      'Lo ignoras ya que no es contigo',
      'Te unes a la discusión para ver que es lo que esa sucediendo',
      'Buscas proteger la atención, apoyar y reportar correctamente si hace falta',
      'Te ríes del caso, entendiendo que ese empleado perdio esa venta'
    ]
  },
  {
    id: 'B20',
    block: 'Bloque B. Juicio laboral y servicio',
    text: 'Te piden quedarte unos minutos más para resolver una situación pendiente importante. ¿Qué harías?',
    type: 'multiple_choice',
    options: [
      'Te niegas de inmediato, ya que termino tu horario laboral',
      'Evalúas el contexto y apoyas siempre que te lo pidan',
      'Te vas antes de que el supervisor te lo pida',
      'Aceptas pero no trabajas igual'
    ]
  },
  {
    id: 'B21',
    block: 'Bloque B. Juicio laboral y servicio',
    text: 'Un cliente deja dinero de más por error. ¿Qué haces?',
    type: 'multiple_choice',
    options: [
      'Esperas a ver si lo reclama',
      'Lo guardas si nadie lo vio',
      'Informas el error y gestionas la devolución',
      'Se lo das a guardar a otro compañero'
    ]
  },
  {
    id: 'B22',
    block: 'Bloque B. Juicio laboral y servicio',
    text: 'Recibes una instrucción poco clara. ¿Qué haces?',
    type: 'multiple_choice',
    options: [
      'Improvisas aunque no entiendas',
      'Preguntas y confirmas antes de ejecutar',
      'Te quedas callado con quienes no entendieron',
      'Haces lo poco que entendiste'
    ]
  },
  {
    id: 'B23',
    block: 'Bloque B. Juicio laboral y servicio',
    text: 'Un compañero te pide usar tu usuario o clave para hacer una operación rápida. ¿Qué haces?',
    type: 'multiple_choice',
    options: [
      'Se la das si hay confianza',
      'Evalúas dependiendo si es amigo',
      'No comparto mi usuario ni mi clave, y si hace falta canalizo la operación correctamente',
      'La compartes una sola vez, si no pasa nada'
    ]
  },
  {
    id: 'B24',
    block: 'Bloque B. Juicio laboral y servicio',
    text: 'Te das cuenta de que un cliente habitual quiere saltarse un proceso aprovechando la confianza. ¿Qué haces?',
    type: 'multiple_choice',
    options: [
      'Lo dejas pasar, si es un buen cliente',
      'Le explicas con respeto que debe seguir el proceso',
      'Lo discutes frente a otros clientes',
      'Haces la excepción 1 sola vez'
    ]
  },

  // Bloque C. Escala de actitudes laborales
  { id: 'C25', block: 'Bloque C. Escala de actitudes laborales', text: 'Me esfuerzo por mantener un trato amable incluso cuando estoy bajo presión.', type: 'scale' },
  { id: 'C26', block: 'Bloque C. Escala de actitudes laborales', text: 'Prefiero seguir un proceso claro antes que improvisar sin control.', type: 'scale' },
  { id: 'C27', block: 'Bloque C. Escala de actitudes laborales', text: 'Acepto mejor una corrección cuando me la explican con claridad.', type: 'scale' },
  { id: 'C28', block: 'Bloque C. Escala de actitudes laborales', text: 'Cuando cometo un error, procuro reconocerlo y corregirlo.', type: 'scale' },
  { id: 'C29', block: 'Bloque C. Escala de actitudes laborales', text: 'Me adapto con facilidad a nuevas formas de trabajo.', type: 'scale' },
  { id: 'C30', block: 'Bloque C. Escala de actitudes laborales', text: 'Suelo mantener la calma cuando alguien me habla de forma incómoda.', type: 'scale' },
  { id: 'C31', block: 'Bloque C. Escala de actitudes laborales', text: 'Valoro la estabilidad laboral y no me gusta cambiar de trabajo sin razón.', type: 'scale' },
  { id: 'C32', block: 'Bloque C. Escala de actitudes laborales', text: 'Me gusta aprender maneras más eficientes de hacer mi trabajo.', type: 'scale' },
  { id: 'C33', block: 'Bloque C. Escala de actitudes laborales', text: 'Puedo trabajar bien aunque me supervisen de cerca.', type: 'scale' },
  { id: 'C34', block: 'Bloque C. Escala de actitudes laborales', text: 'Me molesta demasiado que me corrijan frente a otros.', type: 'scale' },
  { id: 'C35', block: 'Bloque C. Escala de actitudes laborales', text: 'Me considero una persona paciente al atender público.', type: 'scale' },
  { id: 'C36', block: 'Bloque C. Escala de actitudes laborales', text: 'Si una regla existe, normalmente la sigo aunque me resulte incómoda.', type: 'scale' },
  { id: 'C37', block: 'Bloque C. Escala de actitudes laborales', text: 'Cuando algo sale mal, reviso primero qué pude haber hecho mejor.', type: 'scale' },
  { id: 'C38', block: 'Bloque C. Escala de actitudes laborales', text: 'Puedo colaborar con otros aunque no piense igual que ellos.', type: 'scale' },
  { id: 'C39', block: 'Bloque C. Escala de actitudes laborales', text: 'Me cuesta controlar mi tono cuando me siento atacado.', type: 'scale' },
  { id: 'C40', block: 'Bloque C. Escala de actitudes laborales', text: 'Cuando no sé algo, prefiero preguntar antes que inventar.', type: 'scale' },
  { id: 'C41', block: 'Bloque C. Escala de actitudes laborales', text: 'Me gusta terminar bien las tareas que empiezo.', type: 'scale' },
  { id: 'C42', block: 'Bloque C. Escala de actitudes laborales', text: 'Suelo reaccionar impulsivamente cuando siento injusticia.', type: 'scale' },
  { id: 'C43', block: 'Bloque C. Escala de actitudes laborales', text: 'Me interesa crecer y mejorar dentro del trabajo.', type: 'scale' },
  { id: 'C44', block: 'Bloque C. Escala de actitudes laborales', text: 'Puedo mantener una actitud profesional aunque esté cansado.', type: 'scale' },
  { id: 'C45', block: 'Bloque C. Escala de actitudes laborales', text: 'Me resulta fácil escuchar antes de responder.', type: 'scale' },
  { id: 'C46', block: 'Bloque C. Escala de actitudes laborales', text: 'Puedo aceptar normas aunque no sean mis favoritas.', type: 'scale' },
  { id: 'C47', block: 'Bloque C. Escala de actitudes laborales', text: 'Me considero una persona confiable en temas de responsabilidad.', type: 'scale' },
  { id: 'C48', block: 'Bloque C. Escala de actitudes laborales', text: 'Prefiero resolver los problemas con calma antes que discutir.', type: 'scale' },

  // Bloque D. Integridad, criterio y cierre
  {
    id: 'D49',
    block: 'Bloque D. Integridad, criterio y cierre',
    text: 'Si ves a un compañero guardando mercancía o un artículo de la empresa sin pagarlo, ¿qué harías primero?',
    type: 'textarea'
  },
  {
    id: 'D50',
    block: 'Bloque D. Integridad, criterio y cierre',
    text: 'Si descubres que se cobró de menos por error y nadie se ha dado cuenta, ¿qué harías?',
    type: 'multiple_choice',
    options: [
      'Lo ignoro, fue un error',
      'Lo informo a mi supervisor para corregirlo',
      'Intento cobrarlo después sin decir nada',
      'Espero a ver si alguien se da cuenta'
    ]
  },
  {
    id: 'D51',
    block: 'Bloque D. Integridad, criterio y cierre',
    text: '¿Qué opinas de la frase "si la empresa no se da cuenta, no pasa nada"?',
    type: 'textarea'
  },
  {
    id: 'D52',
    block: 'Bloque D. Integridad, criterio y cierre',
    text: 'Si un amigo dentro del trabajo te pide cubrirle una falta grave para que no tenga problemas, ¿qué harías?',
    type: 'textarea'
  },
  {
    id: 'D53',
    block: 'Bloque D. Integridad, criterio y cierre',
    text: 'Si un cliente te ofrece dinero, un regalo o un favor para que le resuelvas fuera del proceso establecido, ¿qué harías?',
    type: 'multiple_choice',
    options: [
      'Lo consideraría si la solicitud no genera un daño a la empresa',
      'Rechazaría la oferta, explicaría que debo cumplir el proceso y reportaría la situación',
      'Buscaría una solución excepcional para evitar perder al cliente',
      'Dejaría pasar la situación sutilmente, sin responder directamente'
    ]
  },
  {
    id: 'D54',
    block: 'Bloque D. Integridad, criterio y cierre',
    text: '¿Qué es más importante en un trabajo: quedar bien con la gente o hacer lo correcto aunque incomode? Explica.',
    type: 'textarea'
  },
  {
    id: 'D55',
    block: 'Bloque D. Integridad, criterio y cierre',
    text: 'Durante la jornada laboral, aparece dinero o un objeto de valor en un área común y no se identifica de inmediato a su dueño. ¿Cuál es la mejor forma de actuar?',
    type: 'multiple_choice',
    options: [
      'Guardarlo de forma segura mientras se localiza al posible dueño',
      'Lo entrego inmediatamente a mi supervisor o al área encargada',
      'Preguntar discretamente entre los presentes antes de reportarlo',
      'Esperar a que alguien lo reclame para evitar involucrar a más personas'
    ]
  },
  {
    id: 'D56',
    block: 'Bloque D. Integridad, criterio y cierre',
    text: '¿Qué harías si sabes que alguien está manipulando un proceso para beneficiarse?',
    type: 'textarea'
  },
  {
    id: 'D57',
    block: 'Bloque D. Integridad, criterio y cierre',
    text: 'Cuando una persona ve una falta y decide no decir nada, ¿eso también es una decisión? Explica.',
    type: 'textarea'
  },
  {
    id: 'D58',
    block: 'Bloque D. Integridad, criterio y cierre',
    text: 'En una empresa, ¿qué daño puede causar una pequeña deshonestidad repetida muchas veces?',
    type: 'textarea'
  },
  {
    id: 'D59',
    block: 'Bloque D. Integridad, criterio y cierre',
    text: 'Después de esta evaluación, ¿por qué entiendes que este puesto podría ser una buena opción para ti?',
    type: 'textarea'
  },
  {
    id: 'D60',
    block: 'Bloque D. Integridad, criterio y cierre',
    text: '¿Qué valor principal sientes que aportarías si te contratan?',
    type: 'textarea'
  },
  {
    id: 'D61',
    block: 'Bloque D. Integridad, criterio y cierre',
    text: '¿Qué parte del trabajo crees que más te costaría al inicio y cómo la enfrentarías?',
    type: 'textarea'
  },
  {
    id: 'D62',
    block: 'Bloque D. Integridad, criterio y cierre',
    text: '¿Hay algo importante sobre ti como trabajador que aún no te hayamos preguntado y consideras útil mencionar?',
    type: 'textarea'
  }
];
