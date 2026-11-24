import { t } from './lib.js';
import { m1, m2, m3 } from './m01-03.js';
import { m4, m5, m6, m7 } from './m04-07.js';
import { m8, m9, m10, m11 } from './m08-11.js';
import { m12, m13, m14, m15, m16 } from './m12-16.js';
import { m17, m18, m19, m20, m21 } from './m17-21.js';

export const MODULES = [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15, m16, m17, m18, m19, m20, m21];

export const LEVELS = [
  { n: 1, title: t('Level 1 · Foundations', 'Niveau 1 · Fondations'), blurb: t('Everyday digital skills for every health worker.', 'Compétences numériques quotidiennes pour tout agent de santé.') },
  { n: 2, title: t('Level 2 · Safe & Responsible Use', 'Niveau 2 · Usage sûr et responsable'), blurb: t('Protect people, data and systems.', 'Protéger les personnes, les données et les systèmes.') },
  { n: 3, title: t('Level 3 · Health Information Systems', 'Niveau 3 · Systèmes d’information sanitaire'), blurb: t('EMR, DHIS2, REDCap, data quality and reporting.', 'DME, DHIS2, REDCap, qualité des données et rapportage.') },
  { n: 4, title: t('Level 4 · Advanced & Emerging', 'Niveau 4 · Avancé et émergent'), blurb: t('AI, telemedicine, standards and problem solving.', 'IA, télémédecine, normes et résolution de problèmes.') },
];

// Final certification exam (ToR: pass mark 70%, max 3 attempts, 3.5 CEUs).
export const EXAM = {
  id: 'final', ceu: 3.5, minutes: 60, passMark: 70, maxAttempts: 3, questions: 40,
  title: t('Final Certification Exam', 'Examen final de certification'),
  summary: t('40 questions drawn across all 21 modules. Pass mark 70%. Up to 3 attempts before trainer support.', '40 questions tirées des 21 modules. Seuil de réussite 70 %. Jusqu’à 3 tentatives avant l’appui d’un formateur.'),
};

// ToR policy: recommended CEUs per 2-year renewal period.
export const POLICY = { renewalYears: 2, renewalCeu: 6.0, certValidityYears: 2 };
