import { describe, it, expect } from 'vitest';
import {
  planCandidateMerge, planApplicationMerge, furthestStage, fillEmpty, isEmptyValue,
  hasEvidence, findDuplicateCandidates, normalizeName, EVIDENCE_GROUPS,
} from './mergeCandidates';

const group = (key: string) => EVIDENCE_GROUPS.find(g => g.key === key)!;

describe('qué cuenta como vacío', () => {
  it('vacío es no tener dato, no "tener algo que parece poco"', () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue('   ')).toBe(true);
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue({})).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue('Ana')).toBe(false);
  });

  it('ni un Timestamp ni un Date son un objeto vacío', () => {
    // Sin esto, la fecha de una respuesta se trataría como "no hay dato" y se perdería.
    expect(isEmptyValue({ seconds: 1, nanoseconds: 0 })).toBe(false);
    expect(isEmptyValue({ toDate: () => new Date() })).toBe(false);
    // Un Date no tiene claves propias enumerables: por conteo de claves daría "vacío".
    expect(isEmptyValue(new Date())).toBe(false);
    expect(isEmptyValue(new Map())).toBe(false);
  });
});

describe('completar sin pisar', () => {
  it('solo rellena los campos vacíos del principal', () => {
    const r = fillEmpty({ phone: '809', email: '' }, { phone: '829', email: 'a@b.c', city: 'Baní' }, ['phone', 'email', 'city']);
    expect(r.fields).toEqual({ email: 'a@b.c', city: 'Baní' });
    expect(r.filled).toEqual(['email', 'city']);
  });
});

describe('la etapa de la postulación unificada', () => {
  it('se queda con la más avanzada de las dos', () => {
    expect(furthestStage('Precalificado', 'Convocado a entrevista')).toBe('Convocado a entrevista');
    expect(furthestStage('Oferta', 'Finalista')).toBe('Oferta');
  });

  it('un descarte no resucita ni descarta: entre activa y terminal gana la activa', () => {
    // 'Descartado' está al final de PIPELINE_STAGES: por índice ganaría siempre y
    // unificar habría descartado a quien iba camino a la oferta.
    expect(furthestStage('Oferta', 'Descartado')).toBe('Oferta');
    expect(furthestStage('Descartado', 'Convocado a entrevista')).toBe('Convocado a entrevista');
    expect(furthestStage('Banco de talento', 'Nuevo')).toBe('Nuevo');
  });

  it('si las dos son un desenlace, se queda la del banco de talento', () => {
    expect(furthestStage('Descartado', 'Banco de talento')).toBe('Banco de talento');
  });

  it('tolera una etapa vacía o desconocida', () => {
    expect(furthestStage('', 'Nuevo')).toBe('Nuevo');
    expect(furthestStage('Finalista', '')).toBe('Finalista');
    expect(furthestStage('EtapaInventada', 'Finalista')).toBe('Finalista');
  });
});

describe('combinar dos postulaciones a la misma vacante', () => {
  it('toma la evidencia que al principal le falta', () => {
    const primary = { id: 'p', vacancyId: 'v1', stage: 'Convocado a entrevista', testResults: { score: 80 }, testAnswers: { q1: 'x' } };
    const dup = { id: 'd', vacancyId: 'v1', stage: 'Precalificado', stage2Answers: { q: 'r' }, stage2Scoring: { total_score: 70 } };
    const plan = planApplicationMerge(primary, dup, 'Vendedor');
    expect(plan.fields.stage2Answers).toEqual({ q: 'r' });
    expect(plan.fields.stage2Scoring).toEqual({ total_score: 70 });
    expect(plan.taken).toContain(group('stage2').label);
    expect(plan.archived).toEqual([]);
    expect(plan.stageChanged).toBe(false);
  });

  it('el caso real: un test en cada perfil — se queda el del principal y el otro se archiva', () => {
    const primary = { id: 'p', vacancyId: 'v1', stage: 'Tests presenciales', testResults: { score: 90 }, testAnswers: { q1: 'principal' } };
    const dup = { id: 'd', vacancyId: 'v1', stage: 'Tests presenciales', testResults: { score: 55 }, testAnswers: { q1: 'duplicado' } };
    const plan = planApplicationMerge(primary, dup, 'Vendedor');
    // Nada se sobreescribe...
    expect(plan.fields.testResults).toBeUndefined();
    expect(plan.fields.testAnswers).toBeUndefined();
    // ...y nada se pierde: el test del duplicado queda archivado y consultable.
    expect(plan.archived).toContain(group('test').label);
    expect(plan.archivedData.testResults).toEqual({ score: 55 });
    expect(plan.archivedData.testAnswers).toEqual({ q1: 'duplicado' });
  });

  it('con evidencia en los dos lados no se mezcla NADA del grupo, ni los huecos sueltos', () => {
    // Mezclar dejaría la puntuación del principal junto a la fecha (o las respuestas)
    // del duplicado: quien audite el Ranking leería respuestas que no dan ese puntaje.
    const primary = { id: 'p', vacancyId: 'v1', stage: 'Nuevo', testResults: { score: 90 } };
    const dup = { id: 'd', vacancyId: 'v1', stage: 'Nuevo', testResults: { score: 40 }, testSubmittedAt: { seconds: 5 } };
    const plan = planApplicationMerge(primary, dup);
    expect(plan.fields.testSubmittedAt).toBeUndefined();
    expect(plan.fields.testResults).toBeUndefined();
    expect(plan.archived).toContain(group('test').label);
    // Y sigue estando todo, archivado junto.
    expect(plan.archivedData).toEqual({ testResults: { score: 40 }, testSubmittedAt: { seconds: 5 } });
  });

  it('el test de personalidad viaja entero: se toma si falta y se archiva si ya había uno', () => {
    const test = { status: 'completed', answers: { S1: 4 }, results: { dimensions: [], warnings: [] } };
    const taken = planApplicationMerge({ id: 'p', vacancyId: 'v1', stage: 'Nuevo' }, { id: 'd', vacancyId: 'v1', stage: 'Nuevo', personalityTest: test });
    expect(taken.fields.personalityTest).toEqual(test);
    expect(taken.taken).toContain(group('personality').label);

    const both = planApplicationMerge(
      { id: 'p', vacancyId: 'v1', stage: 'Nuevo', personalityTest: { status: 'completed', answers: { S1: 2 } } },
      { id: 'd', vacancyId: 'v1', stage: 'Nuevo', personalityTest: test },
    );
    expect(both.fields.personalityTest).toBeUndefined();
    expect(both.archivedData.personalityTest).toEqual(test);
  });

  it('sube la etapa cuando el duplicado llegó más lejos', () => {
    const plan = planApplicationMerge(
      { id: 'p', vacancyId: 'v1', stage: 'Precalificado' },
      { id: 'd', vacancyId: 'v1', stage: 'Finalista' },
    );
    expect(plan.fields.stage).toBe('Finalista');
    expect(plan.stageChanged).toBe(true);
  });

  it('la asistencia a la entrevista viaja con la convocatoria, no suelta', () => {
    const plan = planApplicationMerge(
      { id: 'p', vacancyId: 'v1', stage: 'Convocado a entrevista' },
      { id: 'd', vacancyId: 'v1', stage: 'Convocado a entrevista', interviewAttendance: { status: 'no_show' }, interviewInvitedAt: { seconds: 9 } },
    );
    expect(plan.fields.interviewAttendance).toEqual({ status: 'no_show' });
    expect(plan.fields.interviewInvitedAt).toEqual({ seconds: 9 });
  });

  it('hasEvidence mira el grupo completo, no un campo', () => {
    expect(hasEvidence({ stage2Scoring: { total_score: 1 } }, group('stage2'))).toBe(true);
    expect(hasEvidence({ stage2Answers: {} }, group('stage2'))).toBe(false);
  });
});

describe('el plan completo de unificación', () => {
  const primary = { id: 'A', fullName: 'Ana Pérez', phone: '8095551234', phoneNormalized: '18095551234', email: '', city: '' };
  const duplicate = { id: 'B', fullName: 'Ana Perez', phone: '829-555-9999', phoneNormalized: '18295559999', email: 'ana@mail.com', city: 'Baní' };

  it('mueve la postulación de una vacante que el principal no tiene', () => {
    const plan = planCandidateMerge({
      primary, duplicate,
      primaryApps: [{ id: 'A_v1', vacancyId: 'v1', stage: 'Convocado a entrevista' }],
      duplicateApps: [{ id: 'B_v2', vacancyId: 'v2', stage: 'Formulario etapa 2 completado' }],
      vacancyTitles: { v1: 'Vendedor', v2: 'Cajero' },
    });
    expect(plan.moves).toEqual([{ appId: 'B_v2', vacancyId: 'v2', vacancyTitle: 'Cajero', stage: 'Formulario etapa 2 completado' }]);
    expect(plan.combines).toEqual([]);
  });

  it('combina cuando los dos aplicaron a la MISMA vacante', () => {
    const plan = planCandidateMerge({
      primary, duplicate,
      primaryApps: [{ id: 'A_v1', vacancyId: 'v1', stage: 'Convocado a entrevista' }],
      duplicateApps: [{ id: 'B_v1', vacancyId: 'v1', stage: 'Nuevo', testResults: { score: 70 } }],
      vacancyTitles: { v1: 'Vendedor' },
    });
    expect(plan.moves).toEqual([]);
    expect(plan.combines).toHaveLength(1);
    expect(plan.combines[0]).toMatchObject({ intoAppId: 'A_v1', fromAppId: 'B_v1', vacancyTitle: 'Vendedor' });
    expect(plan.combines[0].fields.testResults).toEqual({ score: 70 });
  });

  it('completa los datos de contacto que faltaban y guarda el teléfono distinto', () => {
    const plan = planCandidateMerge({ primary, duplicate, primaryApps: [], duplicateApps: [] });
    expect(plan.candidateFields.email).toBe('ana@mail.com');
    expect(plan.candidateFields.city).toBe('Baní');
    // El nombre y el teléfono del principal no se tocan...
    expect(plan.candidateFields.fullName).toBeUndefined();
    expect(plan.candidateFields.phone).toBeUndefined();
    // ...pero el teléfono distinto (la razón del duplicado) se conserva para el buscador.
    expect(plan.alternatePhones).toEqual(expect.arrayContaining(['829-555-9999', '18295559999']));
    expect(plan.alternateEmails).toEqual(['ana@mail.com']);
  });

  it('no inventa alternativos cuando el contacto es el mismo', () => {
    const plan = planCandidateMerge({
      primary: { id: 'A', phone: '8095551234', phoneNormalized: '18095551234', email: 'a@b.c' },
      duplicate: { id: 'B', phone: '8095551234', phoneNormalized: '18095551234', email: 'A@B.C' },
      primaryApps: [], duplicateApps: [],
    });
    expect(plan.alternatePhones).toEqual([]);
    expect(plan.alternateEmails).toEqual([]);
  });

  it('dos postulaciones del duplicado a la misma vacante: una se muda y la otra se combina con ella', () => {
    // Si las dos se mudaran, el perfil unificado quedaría con el duplicado DENTRO.
    const plan = planCandidateMerge({
      primary, duplicate,
      primaryApps: [],
      duplicateApps: [
        { id: 'B_v9', vacancyId: 'v9', stage: 'Nuevo' },
        { id: 'B_v9_bis', vacancyId: 'v9', stage: 'Precalificado', testResults: { score: 60 } },
      ],
    });
    expect(plan.moves.map(m => m.appId)).toEqual(['B_v9']);
    expect(plan.combines).toHaveLength(1);
    expect(plan.combines[0]).toMatchObject({ intoAppId: 'B_v9', fromAppId: 'B_v9_bis' });
  });

  it('avisa cuando no hay nada que unificar', () => {
    const plan = planCandidateMerge({
      primary: { id: 'A', fullName: 'Ana', phone: '1', email: 'a@b.c' },
      duplicate: { id: 'B' },
      primaryApps: [], duplicateApps: [],
    });
    expect(plan.empty).toBe(true);
  });
});

describe('encontrar al duplicado', () => {
  const target = { id: 'A', phoneNormalized: '18095551234', email: 'ana@mail.com', fullName: 'Ana Pérez' };
  const base = [
    { id: 'B', phoneNormalized: '18095551234', fullName: 'A. Perez' },
    { id: 'C', email: 'ANA@MAIL.COM', fullName: 'Otra' },
    { id: 'D', fullName: 'ana perez' },
    { id: 'E', fullName: 'Juan', phoneNormalized: '18090000000' },
  ];

  it('propone por teléfono, correo o nombre completo, y el teléfono manda', () => {
    const dups = findDuplicateCandidates(target, base);
    expect(dups.map(d => d.id)).toEqual(['B', 'C', 'D']);
    expect(dups[0].reasons).toEqual(['phone']);
  });

  it('no se propone a sí mismo ni a un perfil ya unificado', () => {
    const dups = findDuplicateCandidates(target, [
      { id: 'A', phoneNormalized: '18095551234' },
      { id: 'F', phoneNormalized: '18095551234', mergedInto: 'otro' },
    ]);
    expect(dups).toEqual([]);
  });

  it('un nombre corto no sugiere unificar a todo el mundo', () => {
    const dups = findDuplicateCandidates({ id: 'X', fullName: 'Ana' }, [{ id: 'Y', fullName: 'ANA' }]);
    expect(dups).toEqual([]);
  });

  it('el nombre se compara sin acentos ni mayúsculas', () => {
    expect(normalizeName(' José  MARÍA ')).toBe('jose maria');
  });
});
