import { describe, it, expect, vi } from 'vitest';

// Los sellos usan los centinelas de Firestore (serverTimestamp, deleteField…). Aquí se
// sustituyen por marcas reconocibles: lo que se prueba es QUÉ campos se escriben, no
// cómo los serializa Firestore.
vi.mock('firebase/firestore', () => ({
  serverTimestamp: () => '<serverTimestamp>',
  deleteField: () => '<deleteField>',
  arrayUnion: (...items: unknown[]) => ({ __arrayUnion: items }),
  increment: (n: number) => ({ __increment: n }),
  Timestamp: { now: () => '<now>' },
}));

import {
  attendanceOf, wasInvitedToInterview, canMarkAttendance, interviewInviteStamp, attendanceFields,
  computeInterviewFunnel, groupInterviewFunnel, invitedWithinDays, pct, isInterviewStage,
} from './interviewAttendance';

const app = (fields: Record<string, any> = {}) => ({ id: 'a1', stage: 'Nuevo', ...fields });

describe('quién cuenta como convocado a entrevista', () => {
  it('el sello es la respuesta fiable, aunque la persona ya haya avanzado o se descarte', () => {
    // Este es el punto de toda la función: si "los invitados" se contaran por la etapa
    // actual, cada descarte haría bajar solo el porcentaje de ausencias.
    expect(wasInvitedToInterview(app({ stage: 'Descartado', interviewInvitedAt: '<t>' }))).toBe(true);
    expect(wasInvitedToInterview(app({ stage: 'Contratado', interviewInvitedAt: '<t>' }))).toBe(true);
  });

  it('sin sello, la etapa actual cubre lo que ya existía antes de esta función', () => {
    expect(wasInvitedToInterview(app({ stage: 'Convocado a entrevista' }))).toBe(true);
    expect(wasInvitedToInterview(app({ stage: 'Entrevista presencial' }))).toBe(true);
    // A estas etapas solo se llega pasando por la entrevista.
    expect(wasInvitedToInterview(app({ stage: 'Finalista' }))).toBe(true);
    expect(wasInvitedToInterview(app({ stage: 'Oferta' }))).toBe(true);
  });

  it('no cuenta a quien nunca llegó a entrevista', () => {
    expect(wasInvitedToInterview(app({ stage: 'Nuevo' }))).toBe(false);
    expect(wasInvitedToInterview(app({ stage: 'Precalificado' }))).toBe(false);
    // Descartado ANTES de la entrevista: sin sello y sin marca, no es un invitado.
    expect(wasInvitedToInterview(app({ stage: 'Descartado' }))).toBe(false);
  });

  it('lo marcado en la página Entrevistas también cuenta como convocatoria', () => {
    expect(wasInvitedToInterview(app({ stage: 'Descartado' }), 'no_show')).toBe(true);
    expect(canMarkAttendance(app({ stage: 'Nuevo' }))).toBe(false);
  });
});

describe('la asistencia registrada', () => {
  it('la marca de la postulación gana sobre el estado de la sesión', () => {
    const a = app({ interviewAttendance: { status: 'attended' } });
    expect(attendanceOf(a, 'no_show')).toBe('attended');
  });

  it('sin marca propia, vale lo registrado en la sesión de entrevista', () => {
    expect(attendanceOf(app(), 'attended')).toBe('attended');
    expect(attendanceOf(app(), 'no_show')).toBe('no_show');
    // 'pending' es "sin registrar", no una ausencia.
    expect(attendanceOf(app(), 'pending')).toBe(null);
    expect(attendanceOf(app())).toBe(null);
  });
});

describe('el sello de convocatoria al mover de etapa', () => {
  it('no sella nada al mover a una etapa que no es de entrevista', () => {
    expect(interviewInviteStamp(app(), 'Nuevo', 'Precalificado')).toEqual({});
    expect(isInterviewStage('Precalificado')).toBe(false);
  });

  it('la primera convocatoria sella la fecha y cuenta una invitación', () => {
    const fields = interviewInviteStamp(app(), 'Precalificado', 'Convocado a entrevista');
    expect(fields.interviewInvitedAt).toBe('<serverTimestamp>');
    expect(fields.interviewLastInvitedAt).toBe('<serverTimestamp>');
    expect(fields.interviewInviteCount).toEqual({ __increment: 1 });
  });

  it('nunca sobreescribe la fecha de la PRIMERA convocatoria', () => {
    const fields = interviewInviteStamp(
      app({ stage: 'Descartado', interviewInvitedAt: '<viejo>' }),
      'Descartado',
      'Convocado a entrevista',
    );
    expect(fields.interviewInvitedAt).toBeUndefined();
    expect(fields.interviewLastInvitedAt).toBe('<serverTimestamp>');
  });

  it('avanzar dentro del proceso (convocado → presencial) no es una convocatoria nueva', () => {
    // Si contara como nueva, borraría la asistencia que el entrevistador acaba de marcar
    // y la persona aparecería dos veces en el total de invitaciones.
    const a = app({
      stage: 'Convocado a entrevista',
      interviewInvitedAt: '<t>',
      interviewAttendance: { status: 'attended', markedBy: 'Ana' },
    });
    expect(interviewInviteStamp(a, 'Convocado a entrevista', 'Entrevista presencial')).toEqual({});
  });

  it('una reconvocatoria archiva la marca anterior y deja la nueva cita sin marcar', () => {
    const a = app({
      stage: 'Descartado',
      interviewInvitedAt: '<t1>',
      interviewAttendance: { status: 'no_show', markedAt: '<t2>', markedBy: 'Ana', stage: 'Convocado a entrevista' },
    });
    const fields = interviewInviteStamp(a, 'Descartado', 'Convocado a entrevista');
    expect(fields.interviewAttendance).toBe('<deleteField>');
    expect(fields.interviewAttendanceLog).toEqual({
      __arrayUnion: [{ status: 'no_show', at: '<t2>', by: 'Ana', stage: 'Convocado a entrevista' }],
    });
    expect(fields.interviewInviteCount).toEqual({ __increment: 1 });
  });
});

describe('marcar la asistencia', () => {
  it('guarda quién marcó, cuándo y desde qué etapa', () => {
    const fields = attendanceFields('no_show', 'Ana', 'Convocado a entrevista', app({ interviewInvitedAt: '<t>' }));
    expect(fields.interviewAttendance).toEqual({
      status: 'no_show',
      markedAt: '<serverTimestamp>',
      markedBy: 'Ana',
      stage: 'Convocado a entrevista',
    });
    expect(fields.interviewInvitedAt).toBeUndefined();
  });

  it('crea el sello que faltaba, para que la entrevista tenga fecha en los períodos', () => {
    const fields = attendanceFields('attended', 'Ana', 'Entrevista presencial', app({ stage: 'Entrevista presencial' }));
    expect(fields.interviewInvitedAt).toBe('<serverTimestamp>');
  });

  it('volver a pulsar la opción ya marcada la borra (corregir un clic equivocado)', () => {
    expect(attendanceFields(null, 'Ana', 'Convocado a entrevista')).toEqual({ interviewAttendance: '<deleteField>' });
  });
});

describe('el embudo de asistencia', () => {
  const invited = (status?: string, extra: Record<string, any> = {}) => ({
    id: Math.random().toString(36).slice(2),
    stage: 'Convocado a entrevista',
    interviewInvitedAt: '<t>',
    ...(status ? { interviewAttendance: { status } } : {}),
    ...extra,
  });

  it('cuenta sobre los convocados y los tres porcentajes suman 100', () => {
    const f = computeInterviewFunnel([
      invited('attended'), invited('attended'), invited('attended'),
      invited('no_show'),
      ...[invited(), invited()],
      { id: 'x', stage: 'Nuevo' }, // nunca convocado: fuera del cálculo
    ]);
    expect(f.invited).toBe(6);
    expect(f.attended).toBe(3);
    expect(f.noShow).toBe(1);
    expect(f.pending).toBe(2);
    expect(f.attendedPct).toBe(50);
    expect(f.noShowPct).toBe(16.7);
    expect(f.pendingPct).toBe(33.3);
    expect(Math.round(f.attendedPct + f.noShowPct + f.pendingPct)).toBe(100);
  });

  it('el porcentaje sobre lo YA marcado no se mueve porque falte gente por marcar', () => {
    const base = [invited('attended'), invited('attended'), invited('attended'), invited('no_show')];
    const conPendientes = computeInterviewFunnel([...base, invited(), invited(), invited()]);
    expect(computeInterviewFunnel(base).attendedPctOfMarked).toBe(75);
    expect(conPendientes.attendedPctOfMarked).toBe(75);
    expect(conPendientes.noShowPctOfMarked).toBe(25);
    // …mientras el porcentaje sobre el total de convocados sí baja.
    expect(conPendientes.attendedPct).toBeLessThan(75);
  });

  it('sin convocados no divide por cero (0%, nunca NaN)', () => {
    const f = computeInterviewFunnel([{ id: 'x', stage: 'Nuevo' }]);
    expect(f).toMatchObject({ invited: 0, attended: 0, noShow: 0, pending: 0, attendedPct: 0, attendedPctOfMarked: 0 });
    expect(pct(3, 0)).toBe(0);
  });

  it('usa lo marcado en la página Entrevistas cuando la postulación no tiene marca', () => {
    const a = invited();
    const f = computeInterviewFunnel([a], new Map([[a.id, 'no_show']]));
    expect(f).toMatchObject({ invited: 1, noShow: 1, pending: 0, noShowPct: 100 });
  });

  it('agrupa por vacante, descarta grupos sin convocados y ordena por volumen', () => {
    const rows = [
      invited('attended', { vacancyId: 'v1' }),
      invited('no_show', { vacancyId: 'v1' }),
      invited('attended', { vacancyId: 'v2' }),
      { id: 'z', stage: 'Nuevo', vacancyId: 'v3' },
    ];
    const groups = groupInterviewFunnel(rows, a => a.vacancyId, k => `Vacante ${k}`);
    expect(groups.map(g => g.key)).toEqual(['v1', 'v2']);
    expect(groups[0].label).toBe('Vacante v1');
    expect(groups[0].funnel.invited).toBe(2);
    expect(groups[0].funnel.noShowPct).toBe(50);
  });
});

describe('el filtro por período', () => {
  const ts = (daysAgo: number) => ({ toDate: () => new Date(Date.now() - daysAgo * 86_400_000) });

  it('deja fuera las convocatorias más viejas que el período', () => {
    const recientes = invitedWithinDays(
      [
        { id: 'a', interviewInvitedAt: ts(3) },
        { id: 'b', interviewInvitedAt: ts(45) },
      ],
      30,
    );
    expect(recientes.map(a => a.id)).toEqual(['a']);
  });

  it('incluye las que no tienen fecha: el período no puede cuadrar peor que el total', () => {
    const rows = [{ id: 'sinFecha', stage: 'Convocado a entrevista' }];
    expect(invitedWithinDays(rows, 30)).toEqual(rows);
    expect(invitedWithinDays(rows, 0)).toEqual(rows); // 0 = todo el histórico
  });
});
