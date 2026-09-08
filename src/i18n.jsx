// i18n.jsx — tiny run-time internationalisation layer for RACE PLAN.
//
//   window.I18N.t(key, params)   → look up + interpolate a string
//   window.t                     → shortcut for I18N.t
//   window.I18N.locale           → current locale ('he' | 'en' | 'fr' | 'es')
//   window.I18N.dir              → 'rtl' | 'ltr' for the current locale
//   window.I18N.setLocale(loc)   → switch language (persists + re-renders)
//   window.I18N.useI18n()        → React hook; re-renders on a language switch
//   window.I18N.fmtNumber/fmtInt/fmtDate → Intl wrappers bound to the locale
//
// No bundler, no dependency: the dictionaries live in DICTS below (also mirrored
// as web/i18n/<loc>.json for reference / future lazy-loaded locales). Hebrew is
// the source language and must stay complete; the parity test enforces that
// every locale carries the same key set.

// ── supported locales ──────────────────────────────────────────────────
const RP_LOCALES = ['he', 'en', 'fr', 'es'];
const RP_RTL = new Set(['he', 'ar']);
const RP_LOCALE_NAMES = { he: 'עברית', en: 'English', fr: 'Français', es: 'Español' };

// ── dictionaries ──────────────────────────────────────────────────────
// Flat, dotted keys. Plurals: define `key.one` / `key.other` (+ `key.few` /
// `key.many` where a locale needs them) and call t(key, { count }).
const DICTS = {
  he: {
    'common.cancel': 'ביטול',
    'common.save': 'שמור',
    'common.saving': 'שומר…',
    'common.delete': 'מחק',
    'common.deleting': 'מוחק…',
    'common.load': 'טען',
    'common.loading': 'טוען…',
    'common.add': 'הוסף',
    'common.close': 'סגור',
    'common.yes': 'כן',
    'common.done': 'סיום',
    'common.back': 'חזרה',
    'common.or': 'או',
    'common.decrease': 'הפחת',
    'common.logo': 'לוגו',
    'common.apply': 'אישור',

    've.pace': 'קצב',
    've.distance': 'מרחק',
    've.minutes': 'דקות',
    've.seconds': 'שניות',
    've.thousandths': 'אלפיות',
    'gpx.badXml': 'קובץ GPX לא תקין',
    'gpx.noPoints': 'לא נמצאו נקודות מסלול בקובץ',
    'common.irreversible': 'הפעולה אינה ניתנת לביטול.',

    'athletes.title': 'מאגר מתאמנים',
    'athletes.roster': 'מתאמנים',
    'athletes.noneYet': 'אין מתאמנים עדיין',
    'athletes.newNamePlaceholder': 'שם מתאמן חדש...',
    'athletes.athlete': 'מתאמן',
    'athletes.planForX': 'תכנן מרוץ ל{name}',
    'athletes.savedPlans': 'תכנונים שמורים',
    'athletes.pickOrAdd': 'בחרו מתאמן מהרשימה, או הוסיפו חדש',
    'athletes.noSavedPlans': 'אין עדיין תכנונים שמורים למתאמן הזה',
    'athletes.segCount.one': 'קטע אחד',
    'athletes.segCount.other': '{count} קטעים',
    'athletes.savedPlansCount.one': 'תכנון שמור אחד',
    'athletes.savedPlansCount.other': '{count} תכנונים שמורים',
    'athletes.deleteAthlete': 'מחק מתאמן',
    'athletes.pickToPlan': 'בחרו מתאמן כדי לתכנן לו מרוץ או לפתוח תכנון קיים',
    'athletes.deleteAthleteQ': 'מחק מתאמן?',
    'athletes.deletePlanQ': 'מחק תכנית?',
    'athletes.deleteAthleteWarn': 'כל התכניות של המתאמן יימחקו לצמיתות.',

    'myplans.untitled': 'תכנון',
    'myplans.title': 'התכנונים שלי',
    'myplans.noneYet': 'אין תכנונים שמורים עדיין',
    'myplans.noneYetHint': 'מלאו שם למטה ולחצו "שמור תכנון נוכחי".',
    'myplans.rename': 'שינוי שם',
    'myplans.namePlaceholder': 'שם לתכנון…',
    'myplans.saved': 'נשמר!',
    'myplans.saveCurrent': 'שמור תכנון נוכחי',
    'myplans.deleteQ': 'מחיקת תכנון?',

    'segTable.distance': 'מרחק ({unit})',
    'segTable.targetPace': 'קצב יעד',
    'segTable.cumulative': 'מצטבר',
    'segTable.elevation': 'גובה',
    'segTable.segTime': 'זמן קטע',
    'segTable.cumTime': 'זמן מצטבר',
    'segTable.total': 'סה"כ',
    'segTable.removeSegment': 'מחק קטע',

    'zone.easy': 'קל',
    'zone.target': 'מטרה',
    'zone.fast': 'מהיר',

    'preset.marathon': 'מרתון',
    'preset.half': 'חצי מרתון',
    'preset.km': '{n} {unit}',

    'units.km': 'ק"מ',
    'units.mi': 'מייל',
    'units.m': 'מ׳',
    'units.ft': 'רגל',
    'units.perKm': '/ ק"מ',
    'units.perMi': '/ מייל',
    'units.kmh': 'קמ"ש',
    'units.mph': 'מיל"ש',
    'units.climb': 'מ׳ טיפוס',
    'units.climbFt': 'רגל טיפוס',

    'signin.tagline': 'תכננו את המרוץ הבא שלכם',
    'signin.google': 'התחברות עם Google',

    'hub.hello': 'שלום {name}',
    'hub.tagline': 'תכננו את המרוץ הבא שלכם',
    'hub.newPlan': 'תכנון מרוץ חדש',
    'hub.newPlanSub': 'מרחק או מסלול · זמן יעד · אסטרטגיה',
    'hub.resume': 'המשך תכנון נוכחי',
    'hub.myPlans': 'התכנונים שלי',
    'hub.myPlansOwnerSub': 'מאגר המתאמנים',
    'hub.myPlansSub': 'תכנונים שמורים בחשבון שלך',
    'hub.raceAdmin': 'ניהול מרוצים',
    'hub.raceAdminSub': 'הוספה · עריכה · הצגה והסתרה · מחיקה',
    'hub.defaultRaceName': 'המרוץ שלי',
    'hub.athleteRaceName': 'המרוץ של {name}',
    'hub.resumeDefault': 'התכנון שלי',

    'settings.title': 'הגדרות',
    'settings.language': 'שפה',
    'settings.units': 'יחידות מידה',
    'settings.metric': 'מטרי (ק"מ)',
    'settings.imperial': 'אימפריאלי (מייל)',
    'settings.open': 'הגדרות',

    'setup.title': 'תכנון מרוץ חדש',
    'setup.distance': 'מרחק',
    'setup.customKm': 'מרחק אחר (ק״מ)',
    'setup.customMi': 'מרחק אחר (מייל)',
    'setup.fromRoute': 'או ממסלול',
    'setup.routeLibrary': 'ספריית מסלולים',
    'setup.importGpx': 'ייבוא GPX',
    'setup.courseChosen': '{name} · {dist}{unit}',
    'setup.hasProfile': 'פרופיל גובה',
    'setup.goalTime': 'זמן יעד',
    'setup.goalSubtitle': '{name} · זמן מטרה',
    'setup.goalShort': 'זמן מטרה קצר מדי',
    'setup.strategy': 'אסטרטגיה',
    'setup.splitStrength': 'עוצמת הספליט',
    'setup.gradeAdjust': 'התאמה לשיפוע המסלול',
    'setup.noElevation': 'אין נתוני גובה',
    'setup.noElevationFile': 'אין נתוני גובה בקובץ',
    'setup.previewLine': '{count} קטעים · קצב {fast}–{slow} {per} · סה"כ {total}',
    'setup.build': 'בנה תוכנית',
    'setup.startEmpty': 'התחל ריק',
    'setup.skip': 'דלג',
    'setup.badDistance': 'מרחק לא תקין',
    'setup.cannotBuild': 'לא ניתן לבנות תוכנית',
    'setup.cannotReadGpx': 'לא ניתן לקרוא את קובץ ה-GPX',
    'setup.blocksNote': '{name} · {dist}{unit} · קטעים של {block}{unit}',
    'setup.fromRouteTitle': 'בניית תוכנית מהמסלול',

    'strategy.negative': 'פתיחה סולידית',
    'strategy.negativeSub': 'איטי ← מהיר',
    'strategy.even': 'יציב',
    'strategy.evenSub': 'קצב אחיד',
    'strategy.positive': 'פתיחה מהירה',
    'strategy.positiveSub': 'מהיר ← איטי',
    'strategy.staged': 'מדורג',
    'strategy.stagedSub': 'שליש-שליש-שליש',

    'pdf.defaultTitle': 'תוכנית מרוץ',
    'pdf.totalTime': 'זמן כולל:',
    'pdf.distance': 'מרחק:',
    'pdf.avgPace': 'קצב ממוצע:',
    'pdf.colDistance': 'מרחק ({unit})',
    'pdf.colPace': 'קצב',
    'pdf.colSegTime': 'זמן מקטע',
    'pdf.colCumTime': 'זמן מצטבר',
    'pdf.madeWith': 'נוצר ב־RACE PLAN By Krispel',
    'share.linkPrompt': 'קישור לשיתוף:',

    'chart.snapPeak': 'הוצמד לפסגה',
    'chart.snapValley': 'הוצמד לשפל',
    'chart.title': 'פרופיל קצב — לפי מרחק מצטבר',
    'chart.dragHint': '  ·  גררו את הקווים להתאמת מקטע לעלייה/ירידה',
    'chart.elevToggle': 'פרופיל גובה',
    'chart.mapTitle': 'מפת המסלול',
    'chart.elevChartTitle': 'פרופיל גובה — מתוך המסלול',
  },

  en: {
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.saving': 'Saving…',
    'common.delete': 'Delete',
    'common.deleting': 'Deleting…',
    'common.load': 'Load',
    'common.loading': 'Loading…',
    'common.add': 'Add',
    'common.close': 'Close',
    'common.yes': 'Yes',
    'common.done': 'Done',
    'common.back': 'Back',
    'common.or': 'or',
    'common.decrease': 'Decrease',
    'common.logo': 'Logo',
    'common.apply': 'Apply',
    've.pace': 'Pace',
    've.distance': 'Distance',
    've.minutes': 'minutes',
    've.seconds': 'seconds',
    've.thousandths': 'thousandths',
    'gpx.badXml': 'Invalid GPX file',
    'gpx.noPoints': 'No route points found in the file',
    'common.irreversible': 'This action cannot be undone.',

    'athletes.title': 'Athlete roster',
    'athletes.roster': 'Athletes',
    'athletes.noneYet': 'No athletes yet',
    'athletes.newNamePlaceholder': 'New athlete name…',
    'athletes.athlete': 'Athlete',
    'athletes.planForX': 'Plan a race for {name}',
    'athletes.savedPlans': 'Saved plans',
    'athletes.pickOrAdd': 'Pick an athlete from the list, or add a new one',
    'athletes.noSavedPlans': 'No saved plans for this athlete yet',
    'athletes.segCount.one': '1 segment',
    'athletes.segCount.other': '{count} segments',
    'athletes.savedPlansCount.one': '1 saved plan',
    'athletes.savedPlansCount.other': '{count} saved plans',
    'athletes.deleteAthlete': 'Delete athlete',
    'athletes.pickToPlan': 'Pick an athlete to plan a race or open an existing plan',
    'athletes.deleteAthleteQ': 'Delete athlete?',
    'athletes.deletePlanQ': 'Delete plan?',
    'athletes.deleteAthleteWarn': "All of this athlete's plans will be permanently deleted.",

    'myplans.untitled': 'Plan',
    'myplans.title': 'My plans',
    'myplans.noneYet': 'No saved plans yet',
    'myplans.noneYetHint': 'Enter a name below and tap "Save current plan".',
    'myplans.rename': 'Rename',
    'myplans.namePlaceholder': 'Plan name…',
    'myplans.saved': 'Saved!',
    'myplans.saveCurrent': 'Save current plan',
    'myplans.deleteQ': 'Delete plan?',

    'segTable.distance': 'Distance ({unit})',
    'segTable.targetPace': 'Target pace',
    'segTable.cumulative': 'Cumulative',
    'segTable.elevation': 'Elevation',
    'segTable.segTime': 'Segment time',
    'segTable.cumTime': 'Cumulative time',
    'segTable.total': 'Total',
    'segTable.removeSegment': 'Delete segment',

    'zone.easy': 'Easy',
    'zone.target': 'Target',
    'zone.fast': 'Fast',

    'preset.marathon': 'Marathon',
    'preset.half': 'Half marathon',
    'preset.km': '{n} {unit}',

    'units.km': 'km',
    'units.mi': 'mi',
    'units.m': 'm',
    'units.ft': 'ft',
    'units.perKm': '/ km',
    'units.perMi': '/ mi',
    'units.kmh': 'km/h',
    'units.mph': 'mph',
    'units.climb': 'm climb',
    'units.climbFt': 'ft climb',

    'signin.tagline': 'Plan your next race',
    'signin.google': 'Sign in with Google',

    'hub.hello': 'Hi {name}',
    'hub.tagline': 'Plan your next race',
    'hub.newPlan': 'New race plan',
    'hub.newPlanSub': 'Distance or route · goal time · strategy',
    'hub.resume': 'Resume current plan',
    'hub.myPlans': 'My plans',
    'hub.myPlansOwnerSub': 'Athlete roster',
    'hub.myPlansSub': 'Plans saved to your account',
    'hub.raceAdmin': 'Manage races',
    'hub.raceAdminSub': 'Add · edit · show/hide · delete',
    'hub.defaultRaceName': 'My race',
    'hub.athleteRaceName': "{name}'s race",
    'hub.resumeDefault': 'My plan',

    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.units': 'Units',
    'settings.metric': 'Metric (km)',
    'settings.imperial': 'Imperial (mi)',
    'settings.open': 'Settings',

    'setup.title': 'New race plan',
    'setup.distance': 'Distance',
    'setup.customKm': 'Other distance (km)',
    'setup.customMi': 'Other distance (mi)',
    'setup.fromRoute': 'or from a route',
    'setup.routeLibrary': 'Route library',
    'setup.importGpx': 'Import GPX',
    'setup.courseChosen': '{name} · {dist}{unit}',
    'setup.hasProfile': 'elevation profile',
    'setup.goalTime': 'Goal time',
    'setup.goalSubtitle': '{name} · goal time',
    'setup.goalShort': 'Goal time too short',
    'setup.strategy': 'Strategy',
    'setup.splitStrength': 'Split strength',
    'setup.gradeAdjust': 'Adjust for route gradient',
    'setup.noElevation': 'no elevation data',
    'setup.noElevationFile': 'no elevation data in the file',
    'setup.previewLine': '{count} segments · pace {fast}–{slow} {per} · total {total}',
    'setup.build': 'Build plan',
    'setup.startEmpty': 'Start empty',
    'setup.skip': 'Skip',
    'setup.badDistance': 'Invalid distance',
    'setup.cannotBuild': 'Could not build a plan',
    'setup.cannotReadGpx': 'Could not read the GPX file',
    'setup.blocksNote': '{name} · {dist}{unit} · {block}{unit} blocks',
    'setup.fromRouteTitle': 'Build a plan from the route',

    'strategy.negative': 'Steady start',
    'strategy.negativeSub': 'slow → fast',
    'strategy.even': 'Even',
    'strategy.evenSub': 'constant pace',
    'strategy.positive': 'Fast start',
    'strategy.positiveSub': 'fast → slow',
    'strategy.staged': 'Staged',
    'strategy.stagedSub': 'thirds',

    'pdf.defaultTitle': 'Race plan',
    'pdf.totalTime': 'Total time:',
    'pdf.distance': 'Distance:',
    'pdf.avgPace': 'Average pace:',
    'pdf.colDistance': 'Distance ({unit})',
    'pdf.colPace': 'Pace',
    'pdf.colSegTime': 'Segment time',
    'pdf.colCumTime': 'Cumulative time',
    'pdf.madeWith': 'Made with RACE PLAN By Krispel',
    'share.linkPrompt': 'Share link:',

    'chart.snapPeak': 'snapped to peak',
    'chart.snapValley': 'snapped to valley',
    'chart.title': 'Pace profile — by cumulative distance',
    'chart.dragHint': '  ·  drag the lines to align a segment to a climb/descent',
    'chart.elevToggle': 'Elevation',
    'chart.mapTitle': 'Route map',
    'chart.elevChartTitle': 'Elevation profile — from the route',
  },

  fr: {
    'common.cancel': 'Annuler',
    'common.save': 'Enregistrer',
    'common.saving': 'Enregistrement…',
    'common.delete': 'Supprimer',
    'common.deleting': 'Suppression…',
    'common.load': 'Charger',
    'common.loading': 'Chargement…',
    'common.add': 'Ajouter',
    'common.close': 'Fermer',
    'common.yes': 'Oui',
    'common.done': 'Terminé',
    'common.back': 'Retour',
    'common.or': 'ou',
    'common.decrease': 'Diminuer',
    'common.logo': 'Logo',
    'common.apply': 'Appliquer',
    've.pace': 'Allure',
    've.distance': 'Distance',
    've.minutes': 'minutes',
    've.seconds': 'secondes',
    've.thousandths': 'millièmes',
    'gpx.badXml': 'Fichier GPX invalide',
    'gpx.noPoints': 'Aucun point de parcours trouvé dans le fichier',
    'common.irreversible': 'Cette action est irréversible.',

    'athletes.title': 'Liste des athlètes',
    'athletes.roster': 'Athlètes',
    'athletes.noneYet': 'Aucun athlète pour l’instant',
    'athletes.newNamePlaceholder': 'Nom du nouvel athlète…',
    'athletes.athlete': 'Athlète',
    'athletes.planForX': 'Planifier une course pour {name}',
    'athletes.savedPlans': 'Plans enregistrés',
    'athletes.pickOrAdd': 'Choisissez un athlète dans la liste ou ajoutez-en un',
    'athletes.noSavedPlans': 'Aucun plan enregistré pour cet athlète',
    'athletes.segCount.one': '1 segment',
    'athletes.segCount.other': '{count} segments',
    'athletes.savedPlansCount.one': '1 plan enregistré',
    'athletes.savedPlansCount.other': '{count} plans enregistrés',
    'athletes.deleteAthlete': 'Supprimer l’athlète',
    'athletes.pickToPlan': 'Choisissez un athlète pour planifier une course ou ouvrir un plan',
    'athletes.deleteAthleteQ': 'Supprimer l’athlète ?',
    'athletes.deletePlanQ': 'Supprimer le plan ?',
    'athletes.deleteAthleteWarn': 'Tous les plans de cet athlète seront définitivement supprimés.',

    'myplans.untitled': 'Plan',
    'myplans.title': 'Mes plans',
    'myplans.noneYet': 'Aucun plan enregistré',
    'myplans.noneYetHint': 'Saisissez un nom ci-dessous et touchez « Enregistrer le plan actuel ».',
    'myplans.rename': 'Renommer',
    'myplans.namePlaceholder': 'Nom du plan…',
    'myplans.saved': 'Enregistré !',
    'myplans.saveCurrent': 'Enregistrer le plan actuel',
    'myplans.deleteQ': 'Supprimer le plan ?',

    'segTable.distance': 'Distance ({unit})',
    'segTable.targetPace': 'Allure cible',
    'segTable.cumulative': 'Cumul',
    'segTable.elevation': 'Altitude',
    'segTable.segTime': 'Temps du segment',
    'segTable.cumTime': 'Temps cumulé',
    'segTable.total': 'Total',
    'segTable.removeSegment': 'Supprimer le segment',

    'zone.easy': 'Facile',
    'zone.target': 'Cible',
    'zone.fast': 'Rapide',

    'preset.marathon': 'Marathon',
    'preset.half': 'Semi-marathon',
    'preset.km': '{n} {unit}',

    'units.km': 'km',
    'units.mi': 'mi',
    'units.m': 'm',
    'units.ft': 'ft',
    'units.perKm': '/ km',
    'units.perMi': '/ mi',
    'units.kmh': 'km/h',
    'units.mph': 'mph',
    'units.climb': 'm D+',
    'units.climbFt': 'ft D+',

    'signin.tagline': 'Planifiez votre prochaine course',
    'signin.google': 'Se connecter avec Google',

    'hub.hello': 'Bonjour {name}',
    'hub.tagline': 'Planifiez votre prochaine course',
    'hub.newPlan': 'Nouveau plan de course',
    'hub.newPlanSub': 'Distance ou parcours · temps visé · stratégie',
    'hub.resume': 'Reprendre le plan en cours',
    'hub.myPlans': 'Mes plans',
    'hub.myPlansOwnerSub': 'Liste des athlètes',
    'hub.myPlansSub': 'Plans enregistrés sur votre compte',
    'hub.raceAdmin': 'Gérer les courses',
    'hub.raceAdminSub': 'Ajouter · modifier · afficher/masquer · supprimer',
    'hub.defaultRaceName': 'Ma course',
    'hub.athleteRaceName': 'Course de {name}',
    'hub.resumeDefault': 'Mon plan',

    'settings.title': 'Paramètres',
    'settings.language': 'Langue',
    'settings.units': 'Unités',
    'settings.metric': 'Métrique (km)',
    'settings.imperial': 'Impérial (mi)',
    'settings.open': 'Paramètres',

    'setup.title': 'Nouveau plan de course',
    'setup.distance': 'Distance',
    'setup.customKm': 'Autre distance (km)',
    'setup.customMi': 'Autre distance (mi)',
    'setup.fromRoute': 'ou depuis un parcours',
    'setup.routeLibrary': 'Bibliothèque de parcours',
    'setup.importGpx': 'Importer un GPX',
    'setup.courseChosen': '{name} · {dist}{unit}',
    'setup.hasProfile': 'profil altimétrique',
    'setup.goalTime': 'Temps visé',
    'setup.goalSubtitle': '{name} · temps visé',
    'setup.goalShort': 'Temps visé trop court',
    'setup.strategy': 'Stratégie',
    'setup.splitStrength': 'Intensité du split',
    'setup.gradeAdjust': 'Ajuster selon le dénivelé',
    'setup.noElevation': 'pas de données d’altitude',
    'setup.noElevationFile': 'pas de données d’altitude dans le fichier',
    'setup.previewLine': '{count} segments · allure {fast}–{slow} {per} · total {total}',
    'setup.build': 'Créer le plan',
    'setup.startEmpty': 'Partir de zéro',
    'setup.skip': 'Ignorer',
    'setup.badDistance': 'Distance invalide',
    'setup.cannotBuild': 'Impossible de créer un plan',
    'setup.cannotReadGpx': 'Impossible de lire le fichier GPX',
    'setup.blocksNote': '{name} · {dist}{unit} · blocs de {block}{unit}',
    'setup.fromRouteTitle': 'Créer un plan à partir du parcours',

    'strategy.negative': 'Départ prudent',
    'strategy.negativeSub': 'lent → rapide',
    'strategy.even': 'Régulier',
    'strategy.evenSub': 'allure constante',
    'strategy.positive': 'Départ rapide',
    'strategy.positiveSub': 'rapide → lent',
    'strategy.staged': 'Par paliers',
    'strategy.stagedSub': 'par tiers',

    'pdf.defaultTitle': 'Plan de course',
    'pdf.totalTime': 'Temps total :',
    'pdf.distance': 'Distance :',
    'pdf.avgPace': 'Allure moyenne :',
    'pdf.colDistance': 'Distance ({unit})',
    'pdf.colPace': 'Allure',
    'pdf.colSegTime': 'Temps du segment',
    'pdf.colCumTime': 'Temps cumulé',
    'pdf.madeWith': 'Créé avec RACE PLAN By Krispel',
    'share.linkPrompt': 'Lien de partage :',

    'chart.snapPeak': 'aligné sur le sommet',
    'chart.snapValley': 'aligné sur le creux',
    'chart.title': 'Profil d’allure — par distance cumulée',
    'chart.dragHint': '  ·  faites glisser les lignes pour aligner un segment sur une montée/descente',
    'chart.elevToggle': 'Altimétrie',
    'chart.mapTitle': 'Carte du parcours',
    'chart.elevChartTitle': 'Profil altimétrique — depuis le parcours',
  },

  es: {
    'common.cancel': 'Cancelar',
    'common.save': 'Guardar',
    'common.saving': 'Guardando…',
    'common.delete': 'Eliminar',
    'common.deleting': 'Eliminando…',
    'common.load': 'Cargar',
    'common.loading': 'Cargando…',
    'common.add': 'Añadir',
    'common.close': 'Cerrar',
    'common.yes': 'Sí',
    'common.done': 'Listo',
    'common.back': 'Volver',
    'common.or': 'o',
    'common.decrease': 'Disminuir',
    'common.logo': 'Logo',
    'common.apply': 'Aplicar',
    've.pace': 'Ritmo',
    've.distance': 'Distancia',
    've.minutes': 'minutos',
    've.seconds': 'segundos',
    've.thousandths': 'milésimas',
    'gpx.badXml': 'Archivo GPX no válido',
    'gpx.noPoints': 'No se encontraron puntos de ruta en el archivo',
    'common.irreversible': 'Esta acción no se puede deshacer.',

    'athletes.title': 'Lista de atletas',
    'athletes.roster': 'Atletas',
    'athletes.noneYet': 'Aún no hay atletas',
    'athletes.newNamePlaceholder': 'Nombre del nuevo atleta…',
    'athletes.athlete': 'Atleta',
    'athletes.planForX': 'Planificar una carrera para {name}',
    'athletes.savedPlans': 'Planes guardados',
    'athletes.pickOrAdd': 'Elige un atleta de la lista o añade uno nuevo',
    'athletes.noSavedPlans': 'Aún no hay planes guardados para este atleta',
    'athletes.segCount.one': '1 tramo',
    'athletes.segCount.other': '{count} tramos',
    'athletes.savedPlansCount.one': '1 plan guardado',
    'athletes.savedPlansCount.other': '{count} planes guardados',
    'athletes.deleteAthlete': 'Eliminar atleta',
    'athletes.pickToPlan': 'Elige un atleta para planificar una carrera o abrir un plan',
    'athletes.deleteAthleteQ': '¿Eliminar atleta?',
    'athletes.deletePlanQ': '¿Eliminar plan?',
    'athletes.deleteAthleteWarn': 'Todos los planes de este atleta se eliminarán permanentemente.',

    'myplans.untitled': 'Plan',
    'myplans.title': 'Mis planes',
    'myplans.noneYet': 'Aún no hay planes guardados',
    'myplans.noneYetHint': 'Escribe un nombre abajo y toca «Guardar plan actual».',
    'myplans.rename': 'Cambiar nombre',
    'myplans.namePlaceholder': 'Nombre del plan…',
    'myplans.saved': '¡Guardado!',
    'myplans.saveCurrent': 'Guardar plan actual',
    'myplans.deleteQ': '¿Eliminar plan?',

    'segTable.distance': 'Distancia ({unit})',
    'segTable.targetPace': 'Ritmo objetivo',
    'segTable.cumulative': 'Acumulado',
    'segTable.elevation': 'Altitud',
    'segTable.segTime': 'Tiempo del tramo',
    'segTable.cumTime': 'Tiempo acumulado',
    'segTable.total': 'Total',
    'segTable.removeSegment': 'Eliminar tramo',

    'zone.easy': 'Suave',
    'zone.target': 'Objetivo',
    'zone.fast': 'Rápido',

    'preset.marathon': 'Maratón',
    'preset.half': 'Media maratón',
    'preset.km': '{n} {unit}',

    'units.km': 'km',
    'units.mi': 'mi',
    'units.m': 'm',
    'units.ft': 'ft',
    'units.perKm': '/ km',
    'units.perMi': '/ mi',
    'units.kmh': 'km/h',
    'units.mph': 'mph',
    'units.climb': 'm desnivel',
    'units.climbFt': 'ft desnivel',

    'signin.tagline': 'Planifica tu próxima carrera',
    'signin.google': 'Iniciar sesión con Google',

    'hub.hello': 'Hola {name}',
    'hub.tagline': 'Planifica tu próxima carrera',
    'hub.newPlan': 'Nuevo plan de carrera',
    'hub.newPlanSub': 'Distancia o ruta · tiempo objetivo · estrategia',
    'hub.resume': 'Retomar el plan actual',
    'hub.myPlans': 'Mis planes',
    'hub.myPlansOwnerSub': 'Lista de atletas',
    'hub.myPlansSub': 'Planes guardados en tu cuenta',
    'hub.raceAdmin': 'Gestionar carreras',
    'hub.raceAdminSub': 'Añadir · editar · mostrar/ocultar · eliminar',
    'hub.defaultRaceName': 'Mi carrera',
    'hub.athleteRaceName': 'Carrera de {name}',
    'hub.resumeDefault': 'Mi plan',

    'settings.title': 'Ajustes',
    'settings.language': 'Idioma',
    'settings.units': 'Unidades',
    'settings.metric': 'Métrico (km)',
    'settings.imperial': 'Imperial (mi)',
    'settings.open': 'Ajustes',

    'setup.title': 'Nuevo plan de carrera',
    'setup.distance': 'Distancia',
    'setup.customKm': 'Otra distancia (km)',
    'setup.customMi': 'Otra distancia (mi)',
    'setup.fromRoute': 'o desde una ruta',
    'setup.routeLibrary': 'Biblioteca de rutas',
    'setup.importGpx': 'Importar GPX',
    'setup.courseChosen': '{name} · {dist}{unit}',
    'setup.hasProfile': 'perfil de altimetría',
    'setup.goalTime': 'Tiempo objetivo',
    'setup.goalSubtitle': '{name} · tiempo objetivo',
    'setup.goalShort': 'Tiempo objetivo demasiado corto',
    'setup.strategy': 'Estrategia',
    'setup.splitStrength': 'Intensidad del split',
    'setup.gradeAdjust': 'Ajustar por el desnivel',
    'setup.noElevation': 'sin datos de altimetría',
    'setup.noElevationFile': 'sin datos de altimetría en el archivo',
    'setup.previewLine': '{count} segmentos · ritmo {fast}–{slow} {per} · total {total}',
    'setup.build': 'Crear plan',
    'setup.startEmpty': 'Empezar vacío',
    'setup.skip': 'Omitir',
    'setup.badDistance': 'Distancia no válida',
    'setup.cannotBuild': 'No se pudo crear el plan',
    'setup.cannotReadGpx': 'No se pudo leer el archivo GPX',
    'setup.blocksNote': '{name} · {dist}{unit} · bloques de {block}{unit}',
    'setup.fromRouteTitle': 'Crear un plan a partir de la ruta',

    'strategy.negative': 'Salida prudente',
    'strategy.negativeSub': 'lento → rápido',
    'strategy.even': 'Constante',
    'strategy.evenSub': 'ritmo uniforme',
    'strategy.positive': 'Salida rápida',
    'strategy.positiveSub': 'rápido → lento',
    'strategy.staged': 'Por tramos',
    'strategy.stagedSub': 'por tercios',

    'pdf.defaultTitle': 'Plan de carrera',
    'pdf.totalTime': 'Tiempo total:',
    'pdf.distance': 'Distancia:',
    'pdf.avgPace': 'Ritmo medio:',
    'pdf.colDistance': 'Distancia ({unit})',
    'pdf.colPace': 'Ritmo',
    'pdf.colSegTime': 'Tiempo del tramo',
    'pdf.colCumTime': 'Tiempo acumulado',
    'pdf.madeWith': 'Hecho con RACE PLAN By Krispel',
    'share.linkPrompt': 'Enlace para compartir:',

    'chart.snapPeak': 'ajustado a la cima',
    'chart.snapValley': 'ajustado al valle',
    'chart.title': 'Perfil de ritmo — por distancia acumulada',
    'chart.dragHint': '  ·  arrastra las líneas para ajustar un tramo a una subida/bajada',
    'chart.elevToggle': 'Altimetría',
    'chart.mapTitle': 'Mapa de la ruta',
    'chart.elevChartTitle': 'Perfil de altimetría — de la ruta',
  },
};

// ── pure helpers (tested in isolation by test/i18n.test.mjs) ───────────

// which locale to start in: ?lang= > localStorage > navigator > 'he'
function resolveLocale(opts) {
  opts = opts || {};
  const supported = (l) => RP_LOCALES.indexOf(l) !== -1;
  const q = opts.query && String(opts.query).slice(0, 2).toLowerCase();
  if (q && supported(q)) return q;
  const stored = opts.stored && String(opts.stored).slice(0, 2).toLowerCase();
  if (stored && supported(stored)) return stored;
  const nav = opts.nav && String(opts.nav).slice(0, 2).toLowerCase();
  if (nav && supported(nav)) return nav;
  return 'he';
}

// "hi {name}" + { name: 'Dana' } → "hi Dana"
function applyParams(str, params) {
  if (!params || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (m, k) =>
    (params[k] === undefined || params[k] === null) ? m : String(params[k]));
}

// pick the plural form for a count in a locale (uses Intl.PluralRules)
function pluralCategory(locale, count) {
  try {
    return new Intl.PluralRules(locale).select(count);
  } catch (e) {
    return count === 1 ? 'one' : 'other';
  }
}

// core lookup: dict + key (+ optional { count } for plurals) → raw string
function lookup(dict, fallbackDict, key, params) {
  let k = key;
  if (params && typeof params.count === 'number') {
    const cat = pluralCategory(params._locale || 'en', params.count);
    if (dict[key + '.' + cat] !== undefined) k = key + '.' + cat;
    else if (dict[key + '.other'] !== undefined) k = key + '.other';
  }
  let raw = dict[k];
  if (raw === undefined && fallbackDict) raw = fallbackDict[k] !== undefined ? fallbackDict[k] : fallbackDict[key];
  if (raw === undefined) raw = key;
  return raw;
}

function makeT(getDict, getFallback, getLocale) {
  const warned = {};
  return function t(key, params) {
    const dict = getDict() || {};
    const fb = getFallback ? getFallback() : null;
    if (dict[key] === undefined && (!params || dict[key + '.other'] === undefined) &&
        (!fb || fb[key] === undefined)) {
      if (!warned[key] && typeof console !== 'undefined') {
        warned[key] = 1;
        try { console.warn('[i18n] missing key:', key); } catch (e) {}
      }
    }
    const p = params ? Object.assign({ _locale: getLocale() }, params) : null;
    return applyParams(lookup(dict, fb, key, p), params);
  };
}

// ── the singleton ─────────────────────────────────────────────────────
const I18N = (() => {
  const win = typeof window !== 'undefined' ? window : {};
  let query = null;
  try { query = new URLSearchParams(win.location ? win.location.search : '').get('lang'); } catch (e) {}
  let stored = null;
  try { stored = win.localStorage && win.localStorage.getItem('rp-locale'); } catch (e) {}
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'he';

  let locale = resolveLocale({ query, stored, nav });
  // an explicit ?lang= wins and is remembered
  if (query && RP_LOCALES.indexOf(query.slice(0, 2).toLowerCase()) !== -1) {
    try { win.localStorage.setItem('rp-locale', locale); } catch (e) {}
  }

  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) {} });

  const getDict = () => DICTS[locale] || DICTS.he;
  const getFallback = () => (locale === 'en' ? null : DICTS.en);
  const t = makeT(getDict, getFallback, () => locale);

  const applyDocument = () => {
    try {
      const d = win.document && win.document.documentElement;
      if (d) { d.lang = locale; d.dir = RP_RTL.has(locale) ? 'rtl' : 'ltr'; }
    } catch (e) {}
  };
  applyDocument();

  const fmtNumber = (n, o) => {
    try { return new Intl.NumberFormat(locale, o).format(n); }
    catch (e) { return String(n); }
  };
  const fmtInt = (n) => fmtNumber(Math.round(n));
  const fmtDate = (dt, o) => {
    try { return new Intl.DateTimeFormat(locale, o).format(dt instanceof Date ? dt : new Date(dt)); }
    catch (e) { return String(dt); }
  };

  function setLocale(loc) {
    loc = String(loc || '').slice(0, 2).toLowerCase();
    if (RP_LOCALES.indexOf(loc) === -1 || loc === locale) return;
    locale = loc;
    try { win.localStorage.setItem('rp-locale', loc); } catch (e) {}
    applyDocument();
    notify();
    try {
      if (win.RP_FIREBASE && win.RP_FIREBASE.saveProfile) win.RP_FIREBASE.saveProfile({ locale: loc });
    } catch (e) {}
  }

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  // React hook — re-renders the caller whenever the language switches.
  function useI18n() {
    const R = win.React;
    if (R && R.useSyncExternalStore) {
      R.useSyncExternalStore(subscribe, () => locale, () => locale);
    } else if (R && R.useState && R.useEffect) {
      const [, force] = R.useState(0);
      R.useEffect(() => subscribe(() => force((x) => x + 1)), []);
    }
    return { t, locale, dir: RP_RTL.has(locale) ? 'rtl' : 'ltr' };
  }

  return {
    t,
    get locale() { return locale; },
    get dir() { return RP_RTL.has(locale) ? 'rtl' : 'ltr'; },
    get isRTL() { return RP_RTL.has(locale); },
    locales: RP_LOCALES.slice(),
    localeNames: Object.assign({}, RP_LOCALE_NAMES),
    setLocale,
    subscribe,
    useI18n,
    fmtNumber,
    fmtInt,
    fmtDate,
    // exposed for tests
    _dicts: DICTS,
    _resolveLocale: resolveLocale,
    _applyParams: applyParams,
    _pluralCategory: pluralCategory,
  };
})();

if (typeof window !== 'undefined') {
  window.I18N = I18N;
  window.t = I18N.t;
}
