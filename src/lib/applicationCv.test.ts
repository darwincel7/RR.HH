import { describe, it, expect } from 'vitest';

import { APPLICATION_SCORE, PROFILE_SCORE, cvForApplication, cvToAnalyze } from './applicationCv';

const candidate = (fields: Record<string, any> = {}) => ({
  cvUrl: 'https://files/perfil.pdf',
  cvFileType: 'application/pdf',
  ...fields,
});

describe('el currículum que se muestra en una postulación', () => {
  it('es el de la postulación cuando envió uno propio', () => {
    const cv = cvForApplication({ cvUrl: 'https://files/nuevo.docx', cvFileType: 'application/msword' }, candidate());
    expect(cv.url).toBe('https://files/nuevo.docx');
    expect(cv.fileType).toBe('application/msword');
    expect(cv.ownedByApplication).toBe(true);
  });

  it('es el del perfil cuando la postulación no guarda ninguno', () => {
    // Postulaciones viejas, de antes de guardar el CV en la postulación.
    const cv = cvForApplication({}, candidate());
    expect(cv.url).toBe('https://files/perfil.pdf');
    expect(cv.fileType).toBe('application/pdf');
    expect(cv.ownedByApplication).toBe(false);
  });

  it('el mismo archivo en los dos sitios no es "de la postulación"', () => {
    const cv = cvForApplication({ cvUrl: 'https://files/perfil.pdf', cvFileType: 'application/pdf' }, candidate());
    expect(cv.ownedByApplication).toBe(false);
    expect(cv.needsOwnAnalysis).toBe(false);
  });

  it('nunca mezcla el archivo de uno con el tipo del otro', () => {
    // Un .doc abierto con el visor de imágenes no se ve: el par va junto o nada.
    const cv = cvForApplication({ cvUrl: 'https://files/nuevo.docx' }, candidate());
    expect(cv.fileType).toBeUndefined();
  });
});

describe('cuándo falta leer con IA el currículum de la postulación', () => {
  const ownCv = { cvUrl: 'https://files/nuevo.docx', cvFileType: 'application/msword' };

  it('trae su propio CV y nadie le ha puesto nota: falta analizarlo', () => {
    expect(cvForApplication(ownCv, candidate()).needsOwnAnalysis).toBe(true);
  });

  it('con una nota HEREDADA del perfil también falta: es de otro currículum', () => {
    // Al reconocer a alguien por su contacto, el CV del perfil no se toca, así que el
    // worker no vuelve a pasar: sin este botón, el CV nuevo no se leería nunca.
    const app = { ...ownCv, scoreSummary: 4, scoreSource: PROFILE_SCORE };
    expect(cvForApplication(app, candidate()).needsOwnAnalysis).toBe(true);
  });

  it('ya analizado su propio CV: no se vuelve a ofrecer', () => {
    const app = { ...ownCv, scoreSummary: 3, scoreSource: APPLICATION_SCORE };
    expect(cvForApplication(app, candidate()).needsOwnAnalysis).toBe(false);
  });

  it('una nota vieja sin origen se respeta como propia', () => {
    // Postulaciones de antes del campo: no se le pide al equipo reanalizar lo revisado.
    expect(cvForApplication({ ...ownCv, scoreSummary: 5 }, candidate()).needsOwnAnalysis).toBe(false);
  });

  it('una nota de 0 cuenta como nota (no es "sin analizar")', () => {
    const app = { ...ownCv, scoreSummary: 0, scoreSource: APPLICATION_SCORE };
    expect(cvForApplication(app, candidate()).needsOwnAnalysis).toBe(false);
  });

  it('sin CV propio no hay nada que analizar aquí', () => {
    expect(cvForApplication({}, candidate()).needsOwnAnalysis).toBe(false);
    expect(cvForApplication(null, candidate()).needsOwnAnalysis).toBe(false);
    expect(cvForApplication(null, null).url).toBeUndefined();
  });
});

describe('qué currículum lee el botón de analizar', () => {
  const perfil = { cvUrl: 'https://files/perfil.pdf', cvFileType: 'application/pdf' };
  const propio = { cvUrl: 'https://files/nuevo.docx', cvFileType: 'application/msword' };

  it('el de la postulación cuando es el suyo el que falta por leer', () => {
    const t = cvToAnalyze(cvForApplication(propio, perfil), perfil);
    expect(t.url).toBe('https://files/nuevo.docx');
    expect(t.fileType).toBe('application/msword');
    expect(t.isProfileCv).toBe(false);
  });

  it('el del perfil cuando el botón sale por su `pending`/`error`, aunque esté abierta otra postulación', () => {
    // Antes se gastaba la pasada de IA en el CV de la postulación abierta y el perfil
    // se quedaba igual de roto, con el botón ahí para siempre.
    const yaPuntuada = { ...propio, scoreSummary: 4, scoreSource: APPLICATION_SCORE };
    const t = cvToAnalyze(cvForApplication(yaPuntuada, perfil), perfil);
    expect(t.url).toBe('https://files/perfil.pdf');
    expect(t.fileType).toBe('application/pdf');
    expect(t.isProfileCv).toBe(true);
  });

  it('una nota heredada manda a leer el CV de la postulación, no el del perfil', () => {
    const heredada = { ...propio, scoreSummary: 4, scoreSource: PROFILE_SCORE };
    expect(cvToAnalyze(cvForApplication(heredada, perfil), perfil).url).toBe('https://files/nuevo.docx');
  });

  it('si el perfil no tiene currículum, se lee el de la postulación (es el único)', () => {
    // Sin esto el botón no hacía nada: apuntaba a un CV que no existe.
    const sinCv = { cvUrl: '' };
    const yaPuntuada = { ...propio, scoreSummary: 4, scoreSource: APPLICATION_SCORE };
    const t = cvToAnalyze(cvForApplication(yaPuntuada, sinCv), sinCv);
    expect(t.url).toBe('https://files/nuevo.docx');
    expect(t.isProfileCv).toBe(false);
  });

  it('con el mismo archivo en los dos sitios, se lee como el del perfil', () => {
    const t = cvToAnalyze(cvForApplication({ ...perfil, scoreSummary: 3 }, perfil), perfil);
    expect(t.url).toBe('https://files/perfil.pdf');
    expect(t.isProfileCv).toBe(true);
  });
});
