/**
 * ¿Qué currículum se está mirando en una postulación, y quién lo ha leído?
 *
 * Una misma persona puede haber aplicado varias veces con currículums distintos. El
 * perfil guarda UNO (el vigente) y cada postulación guarda el que la acompañó, así que
 * "el CV de esta postulación" y "el CV del perfil" no siempre son el mismo archivo — y
 * la nota de IA que se ve puede venir de cualquiera de los dos.
 *
 * `scoreSource` es lo que distingue una nota HEREDADA del perfil (mejor que ninguna,
 * pero de otro currículum) de la que salió de leer el CV de esta postulación. Sin ese
 * dato no se puede saber si falta analizar algo, y una postulación se quedaría para
 * siempre con la nota de un currículum que nunca presentó.
 */

/** La nota vino del CV del perfil, no del de esta postulación. */
export const PROFILE_SCORE = 'perfil';
/** La nota salió de leer el CV que acompañó a ESTA postulación. */
export const APPLICATION_SCORE = 'postulacion';

export interface ShownCv {
  url: any;
  fileType: any;
  /** El archivo es el de la postulación y no el del perfil. */
  ownedByApplication: boolean;
  /** Este currículum no lo ha leído la IA: hay que ofrecer el botón de analizarlo. */
  needsOwnAnalysis: boolean;
}

/**
 * El par url+tipo sale SIEMPRE de la misma fuente: mezclarlos elegiría el visor de un
 * CV para el archivo de otro (un .doc abierto como imagen no se ve).
 */
export function cvForApplication(application: any, candidate: any): ShownCv {
  const own = !!application?.cvUrl;
  const url = own ? application.cvUrl : candidate?.cvUrl;
  const fileType = own ? application.cvFileType : candidate?.cvFileType;
  const ownedByApplication = own && application.cvUrl !== candidate?.cvUrl;

  // Una nota sin `scoreSource` es de antes de que existiera el campo: se respeta como
  // propia, para no pedirle al equipo que reanalice lo que ya revisó.
  const score = application?.scoreSummary;
  const scoredFromOwnCv = score !== undefined && score !== null && application?.scoreSource !== PROFILE_SCORE;

  return { url, fileType, ownedByApplication, needsOwnAnalysis: ownedByApplication && !scoredFromOwnCv };
}
