# Race Plan — מאגר מרתונים וחצאי מרתון בכביש

## מטרת המסמך

מסמך אפיון פיתוח למאגר גלובלי של תחרויות **כביש בלבד** עבור אפליקציית Race Plan. ה־JSON של רשימת ה־seed נשמר בנפרד ומסמך זה מגדיר כיצד לקלוט, לאמת, לשמור, להציג ולעדכן אותו.

## גבולות המוצר

### כלול ב־MVP

- מרתון כביש רשמי: 42.195 ק״מ.
- חצי מרתון כביש רשמי: 21.0975 ק״מ.
- מרוצים פיזיים בלבד, עם מהדורה שנתית ותאריך מאומת.
- עמוד מארגן רשמי, או עמוד רשמי של סדרה/פלטפורמת הרשמה.
- מיקום ברמת עיר, מדינה, ונקודת זינוק כאשר היא ידועה.
- מסלול: GPX מועדף; מפת מסלול רשמית או קישור מארגן מותרים רק כאשר אין GPX מאומת.

### לא כלול ב־MVP

- Trail, ultra, mountain, obstacle, relay, 5K, 10K, ילדים ומרוצים וירטואליים.
- GPX שמוצג כ״רשמי״ ללא מקור מארגן מאומת.
- מסלול כללי של עיר במקום מסלול המרוץ עצמו.
- ערבוב בין נתוני שנים שונות של אותו מרוץ.

## עקרון זהות הנתונים

היחידה המוצגת למשתמש היא **מקצה במהדורה**:

`race + edition year + distance + course version`

דוגמה:

`TCS London Marathon / 2027 / marathon / official course v1`

אין לשמור או להציג “London Marathon GPX” ללא שנת מהדורה וללא מרחק. מרוץ יכול לכלול מספר מקצים, וכל מקצה יכול לקבל מסלול אחר; גם אותו מרוץ עשוי לשנות מסלול בין שנים.

## מודל הישויות

### Race

ישות קבועה של מותג המרוץ.

שדות מינימום:

```ts
type Race = {
  id: string
  canonicalName: string
  organizerName?: string
  officialUrl: string
  city: string
  region?: string
  countryCode: string // ISO 3166-1 alpha-2
  popularityTier: 1 | 2 | 3
  isActive: boolean
  createdAt: string
  updatedAt: string
}
```

### RaceEdition

מהדורה שנתית של המרוץ.

```ts
type RaceEdition = {
  id: string
  raceId: string
  year: number
  eventDate: string // YYYY-MM-DD
  timezone: string // IANA, לדוגמה Europe/London
  officialEditionUrl: string
  registrationUrl?: string
  registrationStatus?: "not_open" | "open" | "waitlist" | "sold_out" | "closed" | "unknown"
  dateStatus: "confirmed" | "provisional"
  lastVerifiedAt: string
  sourceStatus: "verified" | "needs_review"
}
```

### RaceEvent

מקצה אחד במהדורה, מרתון או חצי מרתון.

```ts
type RaceEvent = {
  id: string
  editionId: string
  distance: "marathon" | "half_marathon"
  officialDistanceM: 42195 | 21097.5
  startAt?: string // ISO 8601 עם אזור זמן
  startName?: string
  startLat?: number
  startLng?: number
  finishName?: string
  finishLat?: number
  finishLng?: number
  courseType?: "loop" | "point_to_point" | "out_and_back" | "unknown"
  certified?: boolean
  bostonQualifier?: boolean
  cutOffMinutes?: number
}
```

### CourseVersion

גרסה של מסלול. חובה להחזיק היסטוריה — לא לעדכן שורה קיימת במקום ליצור גרסה חדשה אם הגאומטריה השתנתה.

```ts
type CourseVersion = {
  id: string
  raceEventId: string
  version: number
  routeStatus: "official" | "organizer_linked" | "licensed_partner" | "community_verified" | "derived_from_official_map" | "unavailable"
  sourceUrl?: string
  sourcePublisher?: string
  sourceLicense?: string
  validForYear: number
  routeMayChange: boolean
  createdAt: string
  verifiedAt?: string
  supersededAt?: string
}
```

### GPXAsset

קובץ המקור והמטא־דאטה המחושב ממנו.

```ts
type GPXAsset = {
  id: string
  courseVersionId: string
  storageUrl: string
  originalSourceUrl: string
  checksumSha256: string
  importedAt: string
  pointCount: number
  calculatedDistanceM: number
  elevationGainM?: number
  elevationLossM?: number
  boundingBox?: [number, number, number, number]
  geoJsonUrl?: string
  qualityScore: number // 0–100
  parseStatus: "valid" | "invalid" | "needs_review"
}
```

## חוקי JSON וקליטה

קובץ ה־seed נפרד מן הנתונים התפעוליים. כל רשומה בו חייבת לכלול לפחות:

```json
{
  "id": "berlin-marathon",
  "name": "BMW Berlin Marathon",
  "distance": "marathon",
  "city": "Berlin",
  "country_code": "DE",
  "tier": 1,
  "gpx_required": true,
  "gpx_status": "needs_verification"
}
```

### ולידציה קשיחה

- `id` ייחודי, lowercase, עם מקפים בלבד: `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- `name` אינו ריק.
- `distance` יכול להיות רק `marathon` או `half_marathon`.
- `country_code` הוא ISO Alpha-2 באותיות גדולות.
- `tier` יכול להיות רק `1`, `2` או `3`.
- `gpx_required` חייב להיות `true` בכל רשומות MVP.
- `gpx_status` יכול להיות רק: `needs_verification`, `candidate_found`, `official`, `organizer_linked`, `licensed_partner`, `community_verified`, `unavailable`.
- אין כפילויות לפי צירוף מנורמל של `name + distance + city + country_code`.
- אותו מרוץ אינו נרשם פעמיים תחת מזהים שונים. אם יש שינוי שם מסחרי, שומרים aliases תחת אותו `race.id`.
- אין `date` בתוך seed catalog אלא אם הוא קשור במפורש ל־`year` של מהדורה. תאריכים חיים נשמרים ב־`RaceEdition`.

### נרמול

- שמור את שם השיווק ב־`canonicalName`; אל תמחק ספונסר מהשם אם זה השם הרשמי הנוכחי.
- החזק `aliases` לחיפוש: שמות קודמים, כתיב מקומי, קיצורים ושם ללא ספונסר.
- שמור קואורדינטות ב־WGS84 (`EPSG:4326`), decimal degrees.
- הצג למשתמשים מרחק רשמי, אך שמור גם מרחק מחושב מה־GPX.
- כל התאריכים הם ISO (`YYYY-MM-DD`); כל אזורי הזמן הם IANA.

## מדיניות GPX

### סדר עדיפות למקורות

1. קובץ GPX או מסלול להורדה באתר המארגן הרשמי.
2. GPX בקישור ישיר של המארגן לפלטפורמה חיצונית.
3. קובץ ממקור בעל רישיון או שותף מורשה.
4. מסלול קהילתי שעבר בדיקה ידנית וגאומטרית.
5. מפת/PDF מסלול רשמית בלבד — נשמרת כ־`derived_from_official_map`, לא כ־`official`.
6. אין מסלול אמין — `unavailable`; לא מייצרים GPX מומצא.

### פירוש סטטוס

| סטטוס | משמעות | מותר לפרסם | תווית UI |
|---|---|---|---|
| `official` | קובץ/מסלול באתר המארגן | כן | Official route |
| `organizer_linked` | קישור ישיר מהאתר הרשמי לשירות חיצוני | כן | Organizer-linked route |
| `licensed_partner` | מקור חיצוני עם הרשאה/רישיון מתועד | כן | Verified partner route |
| `community_verified` | מקור קהילתי שעבר QA | כן, עם הסתייגות | Community-verified route |
| `derived_from_official_map` | מסלול שהופק ממפת מארגן | כן, עם אזהרה | Based on official map |
| `candidate_found` | קיים קישור אפשרי אך טרם אומת | לא | לא מוצג למשתמש |
| `needs_verification` | טרם נמצא/אומת קובץ | לא | Route pending |
| `unavailable` | אין מקור תקין | כן, ללא מסלול | Route unavailable |

### איסורים

- אסור לשנות, להניח או לשכפל GPX של שנה קודמת עבור השנה הבאה בלי לציין שהוא historical.
- אסור להציג GPX קהילתי כ־Official.
- אסור להסיר attribution, מקור, תנאי רישיון או מגבלות שימוש.
- אסור לאחסן מחדש קובץ כאשר תנאי המקור מתירים צפייה/קישור בלבד; במקרה כזה שמור `sourceUrl` והפנה למקור.
- אסור לחשב מסלול אוטומטי בין זינוק לסיום ולהציגו כמסלול מרוץ.

## תהליך איסוף ואימות

### גילוי

מקורות לגילוי בלבד:

- אתר המארגן ודפי ההרשמה.
- AIMS calendar.
- World Athletics Label Road Races.
- פלטפורמות רישום כגון RunSignup, בעיקר לארה״ב.
- מקורות מסלולים צד־שלישי, אך רק כ־leads לאימות.

### אימות תחרות

לפני פרסום מהדורה:

1. מצא את דף המהדורה הרשמי.
2. אמת שם, עיר, מדינה, תאריך ומרחק.
3. קבע `timezone` לפי מיקום האירוע.
4. שמור URL מקור, זמן איסוף, ותוצאת האימות.
5. אם התאריך לא מאומת באתר המארגן, הגדר `dateStatus: provisional` ואל תציג אותו כוודאי.

### אימות GPX

1. הורד או פתח את המקור לפי תנאי השימוש.
2. ודא שהוא שייך ל־race, year ו־distance המדויקים.
3. חשב SHA-256 לקובץ המקור.
4. פרסר GPX, המר GeoJSON להצגה, ושמור את ה־GPX המקורי בנפרד.
5. חשב מרחק, ascent, descent, נקודות, bounding box ומיקום זינוק/סיום.
6. בדוק שאין קפיצות GPS, נקודות חסרות או מסלול במדינה לא נכונה.
7. בדיקה ידנית מול מפת המארגן.
8. הענק `routeStatus` ו־`qualityScore`; פרסם רק אם הסטטוס עומד במדיניות הפרסום.

## כללי QA גאומטריים

### מרחק

יש לחשב מרחק לאורך ה־track ב־Haversine או ספרייה גאודזית מדויקת.

המסלול הרשמי יכול להיות מעט ארוך מן המרחק הנומינלי בגלל GPS, קווי מדידה וסימון. דגל לבדיקה ידנית אם:

- מרתון: המרחק המחושב קטן מ־40,500 מ׳ או גדול מ־44,000 מ׳.
- חצי מרתון: המרחק המחושב קטן מ־20,300 מ׳ או גדול מ־22,500 מ׳.

אל תפסול אוטומטית GPX תקין רק משום שהמרחק אינו בדיוק 42,195 או 21,097.5 מ׳. GPS וחתכי פינות יוצרים סטייה.

### קואורדינטות ומסלול

- latitude חייב להיות בין `-90` ל־`90`; longitude בין `-180` ל־`180`.
- חייבים לפחות 2 trackpoints למסלול, ומומלץ 100 ומעלה.
- קפיצה רציפה של יותר מ־2 ק״מ בין נקודות צריכה להיכנס ל־review.
- המסלול צריך לחפוף באופן סביר לעיר/אזור המרוץ; חריגה ניכרת דורשת בדיקה.
- אם ל־GPX יש timestamps, אין להסיק מהם שעת זינוק או קצב מרוץ.

### Quality score

ניקוד מוצע מ־0 עד 100:

- מקור רשמי: 40 נקודות; מקור מארגן־מקושר: 30; שותף מורשה: 25; קהילה מאומתת: 15.
- התאמת year + distance מוכחת: 25 נקודות.
- בדיקה ידנית מול מפה רשמית: 20 נקודות.
- מרחק/גאומטריה בתחום סביר: 10 נקודות.
- מטא־דאטה מלא: 5 נקודות.

ספי פרסום:

- `official` / `organizer_linked`: 70 ומעלה.
- `licensed_partner`: 75 ומעלה.
- `community_verified`: 80 ומעלה ובדיקת אדם.
- `derived_from_official_map`: 80 ומעלה, עם אזהרה ב־UI.

## מדיניות פרסום

### פרסום מרוץ ללא GPX

אפשר לפרסם עמוד מהדורה ללא GPX רק אם יש:

- מקור רשמי פעיל.
- תאריך `confirmed`.
- עיר ומדינה.
- המרחק המדויק.
- `routeStatus: unavailable` או `needs_verification` שמוצג כשקוף למשתמש.

### פרסום מסלול

מסלול יוצג במפה רק אם:

- המהדורה והמקצה תואמים במפורש.
- קיים URL מקור.
- `routeStatus` אינו `candidate_found` ואינו `needs_verification`.
- הקובץ עבר QA וה־`parseStatus` הוא `valid`.
- הייחוס ותנאי הרישיון נשמרו.

### הודעות משתמש

- “מסלול רשמי” רק עבור `official`.
- “מסלול בקישור המארגן” עבור `organizer_linked`.
- “מסלול קהילתי מאומת — ייתכן שינוי” עבור `community_verified`.
- “מבוסס על מפת מארגן — יש לאמת לפני יום המרוץ” עבור `derived_from_official_map`.
- “מסלול למהדורה זו טרם פורסם” עבור `needs_verification`.

## API מוצע

### קריאת רשימת מרוצים

`GET /v1/races?distance=marathon&country=DE&year=2027&has_gpx=true`

פילטרים:

- `distance`: `marathon` או `half_marathon`.
- `country`: ISO Alpha-2.
- `city`.
- `year`.
- `date_from`, `date_to`.
- `tier`.
- `has_gpx`.
- `route_status`.
- `date_status`.
- `sort`: `date`, `popularity`, `gpx_quality`, `name`.

### עמוד מרוץ

`GET /v1/races/{raceId}`

מחזיר מידע קבוע, aliases, מהדורות ומקצים.

### עמוד מהדורה/מקצה

`GET /v1/race-events/{raceEventId}`

מחזיר את נתוני המהדורה, מסלול נוכחי, סטטוס GPX, attribution, איכות, מפת GeoJSON וקישורי מקור.

### דוגמת תגובה

```json
{
  "race_event_id": "berlin-marathon-2027-marathon",
  "race": {
    "id": "berlin-marathon",
    "name": "BMW Berlin Marathon",
    "city": "Berlin",
    "country_code": "DE"
  },
  "edition": {
    "year": 2027,
    "date": "2027-09-26",
    "timezone": "Europe/Berlin",
    "date_status": "confirmed"
  },
  "event": {
    "distance": "marathon",
    "official_distance_m": 42195
  },
  "course": {
    "route_status": "official",
    "route_may_change": false,
    "calculated_distance_m": 42310,
    "elevation_gain_m": 245,
    "geojson_url": "https://cdn.example.com/courses/berlin-2027-marathon.geojson",
    "source_url": "https://official-organizer.example/course",
    "verified_at": "2027-08-30T09:10:00Z"
  }
}
```

## UX באפליקציה

### רשימת מרוצים

בכרטיס מרוץ הצג:

- שם, מרחק, תאריך, עיר ודגל מדינה.
- Tier או תגית “Major” כשמתאים.
- תגית מסלול: `Official route`, `Verified route`, `Route pending` או `Route unavailable`.
- אינדיקציה ברורה אם התאריך provisional.

### עמוד מרוץ

הצג:

- פרטי מהדורה ומקור רשמי.
- מפת מסלול אינטראקטיבית רק לאחר QA.
- פרופיל גובה, מרחק מחושב, זינוק/סיום, סוג מסלול.
- מקור GPX, סטטוס ו־“נבדק לאחרונה”.
- אזהרת `routeMayChange` עד לפרסום מסלול סופי.
- כפתור “Report outdated route” ו־“Open official source”.

### שפה וזמנים

- אחסן שמות רשמיים באנגלית/בשפת המארגן; אפשר להוסיף תרגום תצוגה מאוחר יותר.
- הצג תאריך ושעה באזור הזמן של המשתמש, אך שמור גם timezone מקומי של האירוע.
- אין לתרגם שמות רשמיים באופן שמקשה על מציאת האתר הרשמי.

## רענון ותחזוקה

### תחרות

- Tier 1: בדיקה שבועית שישה חודשים לפני המרוץ; 48–72 שעות בחודש האחרון.
- Tier 2: בדיקה דו־שבועית שלושה עד שישה חודשים לפני המרוץ; שבועית בחודש האחרון.
- Tier 3: בדיקה חודשית, ובדיקה נוספת כאשר מתקבל דיווח משתמש.
- לאחר סיום אירוע: ארכוב המהדורה והמסלול; יצירת מהדורה עתידית נפרדת בלבד לאחר גילוי מקור רשמי.

### מסלול

- בדיקה בעת יבוא GPX.
- בדיקה מחדש כשמתפרסמת מפת מסלול מעודכנת.
- בדיקה 14 ימים לפני המרוץ עבור Tier 1 ו־Tier 2.
- שמירת כל checksum ותאריך אימות לצורך audit והיסטוריה.

## אבטחה, רישוי ואתיקה

- שמור attribution, URL מקור ותנאי רישיון לכל נכס מסלול.
- העדף קישור למקור אם אין היתר מפורש לאחסן ולהפיץ את הקובץ.
- שמור רק מידע ציבורי על אירועים; אין לאסוף נתוני רצים אישיים.
- כבד robots.txt, תנאי שימוש, rate limits ודרישות API של כל מקור.
- אל תעקוף מנגנוני התחברות, paywall, CAPTCHA או הרשאות גישה.
- בנה לוג audit: מקור, זמן איסוף, משתמש/worker, checksum, שינוי סטטוס וסיבת שינוי.

## Pipeline מוצע

1. יבוא ה־seed JSON אל `races`.
2. יצירת משימות מחקר לפי `tier`, `distance` ו־`gpx_status`.
3. איתור אתר רשמי ומהדורה פעילה.
4. יצירת `RaceEdition` ו־`RaceEvent` רק לאחר אימות.
5. איתור/יבוא מקור מסלול בהתאם לסדר העדיפות.
6. פרסור GPX, יצירת GeoJSON, חישובים גאומטריים ו־QA.
7. יצירת `CourseVersion`; לעולם לא overwrite למסלול קודם.
8. פרסום לפי חוקי ה־route status וה־quality score.
9. רענון, ניטור קישורים שבורים, ודיווחי משתמשים.

## קריטריוני קבלה

הפיצ׳ר מוכן ל־MVP כאשר:

- נטען seed של 100 מרוצים לאחר deduplication.
- לכל רשומה מרחק תקין, עיר, מדינה, tier ו־ID תקין.
- ניתן לסנן מרתון/חצי מרתון, מדינה, שנה, טווח תאריכים ו־GPX זמין.
- לכל מהדורה שמפורסמת יש מקור רשמי, תאריך מאומת ו־timezone.
- כל GPX שפורסם כולל מקור, סטטוס, בדיקת תקינות, checksum וזמן אימות.
- ממשק משתמש אינו מציג מסלול לא מאומת כ־Official.
- שינוי GPX יוצר `CourseVersion` חדשה ואינו מוחק היסטוריה.
- כל עמוד מחזיק כפתור פתיחת מקור רשמי ודיווח על מסלול/תאריך מיושן.

## החלטות פתוחות

- האם לתת למשתמש הורדת GPX, או רק צפייה במפה וקישור מקור? ברירת המחדל המומלצת: צפייה + קישור, והורדה רק כאשר הרישיון מתיר זאת.
- האם לכלול נתוני הרשמה, הגרלות, qualification ומחירים ב־MVP הבא?
- האם לאפשר crowd submissions? אם כן, חובה תור moderation ולא פרסום אוטומטי.
- מהו ספק המפות: Mapbox, Google Maps או OpenStreetMap/MapLibre?
- האם להפעיל שכבת admin פנימית ל־QA, סטטוס מקורות והיסטוריית שינויים? מומלץ מאוד.
