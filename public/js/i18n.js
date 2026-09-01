/**
 * CSP-GAMES internationalization layer.
 *
 * Loaded as a classic script before every other client script so both the
 * ES-module game screens and the IIFE controller can read `window.CSPI18n`.
 * Runs its `<html lang>`/`<html dir>` update synchronously at parse time to
 * avoid a flash of the wrong direction before DOMContentLoaded.
 *
 * Markup binds text declaratively:
 *   <title data-i18n="hub.docTitle"></title>
 *   <p data-i18n="lobby.scanHint"></p>
 *   <input data-i18n-placeholder="lobby.joinPlaceholder" />
 *   <button data-i18n-aria-label="common.close"></button>
 *
 * Scripts build dynamic strings with `t('key', { name: 'Dana' })`.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'csp-lang';
  const DEFAULT_LANG = 'en';
  const RTL_LANGS = ['he'];

  const DICT = {
    en: {
      lang: {
        name: 'English',
        short: 'EN',
        switchTo: 'Switch to Hebrew',
        label: 'Language',
      },
      common: {
        player1: 'Player 1',
        player2: 'Player 2',
        p1Short: 'P1',
        p2Short: 'P2',
        computer: 'Computer',
        ready: 'Ready',
        notReady: 'Not ready',
        waiting: 'Waiting',
        offline: 'Offline',
        online: 'Connected',
        back: 'Back',
        lobby: 'Lobby',
        close: 'Close',
        home: 'Home',
        power: 'Power',
        backToLobby: 'Back to lobby',
      },
      hub: {
        docTitle: 'CSP-GAMES — your phone is the controller',
        eyebrow: 'CSP-GAMES',
        title: 'Your phone is the controller',
        subtitle:
          'Pick a game, scan the code with your phone, and swing. No app to install.',
        playNow: 'Play now',
        tennisTitle: 'Tennis',
        tennisDesc: 'Swing your phone like a racket on a full 3D court.',
        tennisTag: '3D · 1–2 players',
        pingpongTitle: 'Ping Pong',
        pingpongDesc: 'The same swing, table-tennis rules. First to 11 wins.',
        pingpongTag: 'Fast · 1–2 players',
        howToTitle: 'How it works',
        step1Title: 'Open a game',
        step1Body: 'Keep this screen on your TV or monitor.',
        step2Title: 'Scan the code',
        step2Body: 'Point your phone camera at the QR code.',
        step3Title: 'Turn on motion',
        step3Body: 'Allow motion access, then tap Ready.',
        step4Title: 'Swing',
        step4Body: 'Your phone becomes the racket. Have fun.',
      },
      lobby: {
        roomLabel: 'Room',
        playersLabel: 'Setup',
        modeOneScreen: 'One screen',
        modeTwoComputers: 'Two computers',
        couchHint:
          'Scan with one or two phones — the first phone is Player 1, the second is Player 2.',
        remoteHint:
          'Playing from another computer? Ask the first player for their room code, enter it below, then scan the code that appears.',
        joinPlaceholder: 'CODE',
        joinButton: 'Join as Player 2',
        copyRoom: 'Copy room code',
        qrPlayer1: 'Player 1',
        qrPlayer2: 'Player 2',
        qrAltP1: 'QR code for player 1',
        qrAltP2: 'QR code for player 2',
        scanHint: 'Scan with your phone camera',
        startVsComputer: 'Play vs Computer',
        start2Players: 'Play 2 Players',
        readyHint: 'Every phone taps Ready, then start the match from this screen.',
        formatLabel: 'Match length',
        format1Set: '1 Set',
        formatBo3: 'Best of 3',
        formatBo5: 'Best of 5',
        steps: {
          scan: 'Scan',
          ready: 'Get ready',
          play: 'Play',
        },
      },
      status: {
        connecting: 'Connecting…',
        settingUp: 'Setting up…',
        reconnected: 'Reconnected.',
        scanQr: 'Scan the code with your phone to join.',
        joiningRoom: 'Joining the room…',
        joinedAsP2:
          'Joined as Player 2 — scan the code below. Player 1 starts the match.',
        connectionProblem: 'Connection problem — check your internet and reload.',
        connectionLost: 'Connection lost — reconnecting…',
        playerJoined: '{player} joined — tap Ready on the phone.',
        playerIsReady: '{player} is ready.',
        playerNotReady: '{player} is not ready.',
        playerLeft: '{player} left.',
        cannotStart: 'Cannot start yet.',
        roomCopied: 'Room code {code} copied.',
        roomCode: 'Room code: {code}',
        codeLength: 'Room codes are 4 characters.',
        shareCode: 'Share your room code with the other player.',
        shareCodeWith:
          'Your room code is {code} — give it to the other player, then scan the code with your phone.',
        scanBothQr: 'Scan the codes — one phone per player.',
        needP1Ready: '{player} needs to tap Ready on the phone first.',
        backInLobby: 'Back in the lobby — tap Ready on the phones to play again.',
        createFailed: 'Could not start a game. Please reload.',
        joinFailed: 'Could not join that room.',
        noGraphics:
          'This device could not load 3D graphics. Try another browser or computer.',
        noCourt: 'Could not load the 3D court — please reload the page.',
      },
      tennis: {
        docTitle: 'Tennis — CSP-GAMES',
        title: 'Tennis',
        tagline: 'Swing your phone. Play on the big screen.',
        sets: 'Sets',
        games: 'Games',
        points: 'Points',
        scoringHint: '15 · 30 · 40 · AD — a set is won at 6 games',
        pointAd: 'AD',
        crowdOn: 'Crowd on',
        crowdOff: 'Crowd off',
        crowdToggle: 'Toggle crowd sound',
        format1Set: '1 Set',
        formatBestOf: 'Best of {n}',
        labelVsAi: '{format} · vs Computer',
        labelLocal: '{format} · 2 Players',
        msg: {
          matchStarted: 'Match started — good luck!',
          youAreBlue: '{format} — you are the blue player',
          goodLuck: '{format} — good luck!',
          serveNear: 'Your serve',
          serveFar: 'Opponent serve',
          deuce: 'Deuce',
          advantage: 'Advantage {player}',
          tiebreak: 'Tiebreak!',
          gameWon: 'Game {player} · {score}',
          setWon: 'Set {player}! Sets {score}',
          matchWon: '{player} wins the match!',
          tooEarly: 'Too early — swing when the ball reaches you',
          needSwing: 'Swing left or right',
          wrongSideRight: 'Wrong side — that ball needed a right swing',
          wrongSideLeft: 'Wrong side — that ball needed a left swing',
          hitRight: 'Right · {place} · power {power}/5',
          hitLeft: 'Left · {place} · power {power}/5',
          calibrated: '{player} calibrated',
          p1Left: '{player} left — back to the lobby',
        },
        place: {
          sameSide: 'same side',
          cross: 'cross court',
          center: 'centre',
        },
        badge: {
          left: 'Swing left',
          right: 'Swing right',
          overhead: 'Overhead',
          center: 'Swing',
        },
        victory: {
          eyebrow: 'Match complete',
          title: 'Winner!',
          sub: 'Wins the match · Sets {score}',
          backToLobby: 'Back to lobby',
        },
      },
      pingpong: {
        docTitle: 'Ping Pong — CSP-GAMES',
        title: 'Ping Pong',
        tagline: 'Swing your phone. First to 11 wins.',
        howTo: 'Hold the phone upright and swing when the ball reaches your side.',
        playing: 'Playing',
        target: 'First to 11',
        msg: {
          tooEarly: 'Too early — swing when the ball reaches you',
          wrongSideRight: 'Wrong side — that ball needed a right swing',
          wrongSideLeft: 'Wrong side — that ball needed a left swing',
          hit: '{player} · power {power}/5',
          hitRight: 'Right · {place} · power {power}/5',
          hitLeft: 'Left · {place} · power {power}/5',
          youAreBlue: 'You are the blue paddle — good luck!',
          goodLuck: 'Good luck!',
          p1Left: '{player} left — back to the lobby',
          serveNear: 'Your serve',
          serveFar: 'Opponent serve',
        },
        victory: {
          eyebrow: 'Match complete',
          title: 'Winner!',
          sub: 'Wins the match · {score}',
        },
      },
      controller: {
        docTitle: 'Controller — CSP-GAMES',
        title: 'Motion controller',
        heading: 'Your phone is the racket',
        connecting: 'Connecting…',
        noRoom: 'Not in a room',
        roomLabel: 'Room {code}',
        connectedAs: 'Connected as {player}',
        howTitle: 'How to swing',
        rule1: 'Ball on the right of the court → swing right',
        rule2: 'Ball on the left of the court → swing left',
        rule3: 'The phone angle at the end of the swing sets where the ball lands',
        rule4: 'A harder swing means a faster ball',
        nameLabel: 'Your name',
        namePlaceholder: 'Type a name…',
        saveName: 'Save',
        nameSaved: 'Name saved on this device.',
        nameUpdated: 'Name updated: {name}',
        enableMotion: 'Enable motion control',
        motionActive: 'Motion control on',
        calibrate: 'Calibrate',
        readyButton: 'I am ready',
        readyButtonOn: 'Ready — tap to cancel',
        readyWaitingConnect: 'Waiting for a connection…',
        readyNeedMotion: 'Turn on motion control, then tap Ready.',
        readyWaitingStart: '{player} is ready — waiting for the match to start.',
        readyPrompt: 'You are {player}. Tap Ready when you want to play.',
        handLabel: 'Dominant hand',
        handRight: 'Right',
        handLeft: 'Left',
        handSetRight: 'Right hand set. Swing right or left depending on where the ball is.',
        handSetLeft: 'Left hand set. Swing right or left depending on where the ball is.',
        practiceButton: 'Practice swings',
        practiceButtonOn: 'Practice mode on',
        practiceTitle: 'Practice swings',
        practiceExit: 'Exit',
        practiceIntro:
          'No ball — swing and see where it would land: side, direction and power.',
        practiceWaiting: 'Waiting for a swing…',
        practiceMissed: 'Not detected — swing a bit harder',
        practiceRight: 'Right swing',
        practiceLeft: 'Left swing',
        practiceLanding: 'Landing: {place} · power {power}/5',
        practiceHint:
          'The phone angle at the end of the swing decides whether the ball goes cross court or to the same side.',
        practiceOn: 'Practice mode: swing and see where the ball would go.',
        practiceOff: 'Practice mode off. Ready to play.',
        practiceNeedMotion: 'Turn on motion control first.',
        practiceReset: 'Reset counters',
        aimLabel: 'Landing direction',
        aimCross: 'Cross court',
        aimCenter: 'Centre',
        aimSame: 'Same side',
        countRight: 'Right',
        countLeft: 'Left',
        countSame: 'Same side',
        countCross: 'Cross',
        countCenter: 'Centre',
        scoreLabel: 'Score',
        holdInstruction: 'Hold the phone upright and push diagonally towards your body',
        calibrated: 'Calibrated! Swing by pushing diagonally towards your body.',
        motionWaiting: 'Waiting for motion control…',
        motionCalibrate: 'Tap Calibrate, then swing like a racket',
        motionPractice: 'Practice mode · swing and see where the ball goes',
        motionReady: 'Ready — swing when the ball reaches you',
        preparingSensors: 'Preparing motion sensors…',
        continueHere: 'Continue here',
        rescan: 'Scan the code from the game screen again.',
        cannotEnableHere: 'Motion sensors cannot be enabled on this page.',
        motionDenied: 'Motion access denied. Allow it in the browser prompt.',
        motionFailed: 'Could not turn on the sensors. Allow the permission and try again.',
        scanToConnect: 'Scan the code on the game screen to connect.',
        disconnected: 'Disconnected — reconnecting…',
        screenClosed: 'The game screen was closed.',
        needMotionFirst: 'Turn on motion control first.',
        touchTitle: 'No motion? Play by touch',
        touchArea: 'Touch area',
        touchHint: 'Swipe right or left to swing',
        touchAria: 'Touch control pad',
        hudPoint: 'Point!',
        hudMiss: 'Missed — wrong side',
        hudHit: 'Hit! Power {power}/5',
        hudSwing: '{side} · {place} · {power}/5',
        hudVsAi: 'Against the computer — good luck!',
        hudLocal: '2 players — good luck!',
        hudWins: '{player} wins!',
        hudWaiting: 'Waiting',
        themeP1: '{player} · Blue',
        themeP2: '{player} · Red',
      },
      errors: {
        ROOM_HAS_SCREEN: 'This room already has a game screen.',
        HOST_FIRST: 'Open the first screen, then join with its room code.',
        ROOM_NOT_FOUND: 'Room not found. Open the game on a computer first.',
        SCREEN_NOT_CONNECTED: 'The game screen is not connected yet.',
        ROOM_FULL: 'This room already has two players.',
        NEED_P1_READY: 'Player 1 must be connected and ready.',
        NEED_P2_READY: 'Player 2 must tap Ready.',
      },
    },

    he: {
      lang: {
        name: 'עברית',
        short: 'עב',
        switchTo: 'החלף לאנגלית',
        label: 'שפה',
      },
      common: {
        player1: 'שחקן 1',
        player2: 'שחקן 2',
        p1Short: 'ש1',
        p2Short: 'ש2',
        computer: 'מחשב',
        ready: 'מוכן',
        notReady: 'לא מוכן',
        waiting: 'ממתין',
        offline: 'לא מחובר',
        online: 'מחובר',
        back: 'חזרה',
        lobby: 'לובי',
        close: 'סגור',
        home: 'דף הבית',
        power: 'עוצמה',
        backToLobby: 'חזרה ללובי',
      },
      hub: {
        docTitle: 'CSP-GAMES — הפלאפון שלך הוא השלט',
        eyebrow: 'CSP-GAMES',
        title: 'הפלאפון שלך הוא השלט',
        subtitle: 'בוחרים משחק, סורקים את הקוד עם הפלאפון, וחובטים. בלי להתקין כלום.',
        playNow: 'שחק עכשיו',
        tennisTitle: 'טניס',
        tennisDesc: 'חובטים עם הפלאפון כמו במחבט, על מגרש תלת-ממדי מלא.',
        tennisTag: 'תלת-ממד · 1–2 שחקנים',
        pingpongTitle: 'פינג פונג',
        pingpongDesc: 'אותה חבטה, חוקים של טניס שולחן. הראשון ל-11 מנצח.',
        pingpongTag: 'מהיר · 1–2 שחקנים',
        howToTitle: 'איך זה עובד',
        step1Title: 'פותחים משחק',
        step1Body: 'משאירים את המסך הזה על הטלוויזיה או המוניטור.',
        step2Title: 'סורקים את הקוד',
        step2Body: 'מכוונים את מצלמת הפלאפון לקוד ה-QR.',
        step3Title: 'מפעילים תנועה',
        step3Body: 'מאשרים גישה לחיישני התנועה ולוחצים מוכן.',
        step4Title: 'חובטים',
        step4Body: 'הפלאפון הופך למחבט. תיהנו.',
      },
      lobby: {
        roomLabel: 'חדר',
        playersLabel: 'הגדרת משחק',
        modeOneScreen: 'מסך אחד',
        modeTwoComputers: 'שני מחשבים',
        couchHint: 'סורקים עם פלאפון אחד או שניים — הפלאפון הראשון הוא שחקן 1, השני שחקן 2.',
        remoteHint:
          'משחקים ממחשב אחר? בקשו מהשחקן הראשון את קוד החדר, הזינו אותו כאן, ואז סרקו את הקוד שיופיע.',
        joinPlaceholder: 'קוד',
        joinButton: 'הצטרף כשחקן 2',
        copyRoom: 'העתק קוד חדר',
        qrPlayer1: 'שחקן 1',
        qrPlayer2: 'שחקן 2',
        qrAltP1: 'קוד QR לשחקן 1',
        qrAltP2: 'קוד QR לשחקן 2',
        scanHint: 'סרקו עם מצלמת הפלאפון',
        startVsComputer: 'שחק מול המחשב',
        start2Players: 'שחק 2 שחקנים',
        readyHint: 'כל פלאפון לוחץ מוכן, ואז מתחילים את המשחק מהמסך הזה.',
        formatLabel: 'אורך המשחק',
        format1Set: 'סט אחד',
        formatBo3: 'הטוב מ-3',
        formatBo5: 'הטוב מ-5',
        steps: {
          scan: 'סריקה',
          ready: 'התארגנות',
          play: 'משחק',
        },
      },
      status: {
        connecting: 'מתחבר…',
        settingUp: 'מכין את המשחק…',
        reconnected: 'התחברנו מחדש.',
        scanQr: 'סרקו את הקוד עם הפלאפון כדי להצטרף.',
        joiningRoom: 'מצטרף לחדר…',
        joinedAsP2: 'הצטרפת כשחקן 2 — סרוק את הקוד למטה. שחקן 1 מתחיל את המשחק.',
        connectionProblem: 'בעיית חיבור — בדקו את האינטרנט ורעננו את הדף.',
        connectionLost: 'החיבור אבד — מתחבר מחדש…',
        playerJoined: '{player} התחבר — לחצו מוכן בפלאפון.',
        playerIsReady: '{player} מוכן.',
        playerNotReady: '{player} לא מוכן.',
        playerLeft: '{player} יצא.',
        cannotStart: 'לא ניתן להתחיל עדיין.',
        roomCopied: 'קוד החדר {code} הועתק.',
        roomCode: 'קוד החדר: {code}',
        codeLength: 'קוד חדר מכיל 4 תווים.',
        shareCode: 'שתפו את קוד החדר עם השחקן השני.',
        shareCodeWith: 'קוד החדר שלך הוא {code} — תנו אותו לשחקן השני, ואז סרקו את הקוד עם הפלאפון.',
        scanBothQr: 'סרקו את הקודים — פלאפון אחד לכל שחקן.',
        needP1Ready: '{player} צריך ללחוץ מוכן בפלאפון קודם.',
        backInLobby: 'חזרנו ללובי — לחצו מוכן בפלאפונים כדי לשחק שוב.',
        createFailed: 'לא ניתן לפתוח משחק. רעננו את הדף.',
        joinFailed: 'לא ניתן להצטרף לחדר הזה.',
        noGraphics: 'המכשיר הזה לא הצליח לטעון גרפיקה תלת-ממדית. נסו דפדפן או מחשב אחר.',
        noCourt: 'לא ניתן לטעון את המגרש — רעננו את הדף.',
      },
      tennis: {
        docTitle: 'טניס — CSP-GAMES',
        title: 'טניס',
        tagline: 'חובטים עם הפלאפון. משחקים על המסך הגדול.',
        sets: 'סטים',
        games: 'גיימים',
        points: 'נקודות',
        scoringHint: '15 · 30 · 40 · יתרון — סט נגמר ב-6 גיימים',
        pointAd: 'יתרון',
        crowdOn: 'קהל דולק',
        crowdOff: 'קהל כבוי',
        crowdToggle: 'הפעלה וכיבוי של קולות הקהל',
        format1Set: 'סט אחד',
        formatBestOf: 'הטוב מ-{n}',
        labelVsAi: '{format} · מול המחשב',
        labelLocal: '{format} · 2 שחקנים',
        msg: {
          matchStarted: 'המשחק התחיל — בהצלחה!',
          youAreBlue: '{format} — אתם השחקן הכחול',
          goodLuck: '{format} — בהצלחה!',
          serveNear: 'הפתיחה שלך',
          serveFar: 'פתיחה של היריב',
          deuce: 'שוויון',
          advantage: 'יתרון ל{player}',
          tiebreak: 'טייברייק!',
          gameWon: 'גיים ל{player} · {score}',
          setWon: 'סט ל{player}! סטים {score}',
          matchWon: '{player} ניצח במשחק!',
          tooEarly: 'מוקדם מדי — חבטו כשהכדור מגיע אליכם',
          needSwing: 'חבטו ימינה או שמאלה',
          wrongSideRight: 'צד לא נכון — הכדור הזה דרש חבטת ימין',
          wrongSideLeft: 'צד לא נכון — הכדור הזה דרש חבטת שמאל',
          hitRight: 'ימין · {place} · עוצמה {power}/5',
          hitLeft: 'שמאל · {place} · עוצמה {power}/5',
          calibrated: '{player} כויל',
          p1Left: '{player} יצא — חוזרים ללובי',
        },
        place: {
          sameSide: 'אותו צד',
          cross: 'צד נגדי',
          center: 'אמצע',
        },
        badge: {
          left: 'חבטת שמאל',
          right: 'חבטת ימין',
          overhead: 'הנחתה',
          center: 'חבטה',
        },
        victory: {
          eyebrow: 'המשחק נגמר',
          title: 'ניצחון!',
          sub: 'ניצח במשחק · סטים {score}',
          backToLobby: 'חזרה ללובי',
        },
      },
      pingpong: {
        docTitle: 'פינג פונג — CSP-GAMES',
        title: 'פינג פונג',
        tagline: 'חובטים עם הפלאפון. הראשון ל-11 מנצח.',
        howTo: 'מחזיקים את הפלאפון זקוף וחובטים כשהכדור מגיע לצד שלכם.',
        playing: 'משחקים',
        target: 'הראשון ל-11',
        msg: {
          tooEarly: 'מוקדם מדי — חבטו כשהכדור מגיע אליכם',
          wrongSideRight: 'צד לא נכון — הכדור הזה דרש חבטת ימין',
          wrongSideLeft: 'צד לא נכון — הכדור הזה דרש חבטת שמאל',
          hit: '{player} · עוצמה {power}/5',
          hitRight: 'ימין · {place} · עוצמה {power}/5',
          hitLeft: 'שמאל · {place} · עוצמה {power}/5',
          youAreBlue: 'אתם המחבט הכחול — בהצלחה!',
          goodLuck: 'בהצלחה!',
          p1Left: '{player} יצא — חוזרים ללובי',
          serveNear: 'ההגשה שלך',
          serveFar: 'הגשה של היריב',
        },
        victory: {
          eyebrow: 'המשחק נגמר',
          title: 'ניצחון!',
          sub: 'ניצח במשחק · {score}',
        },
      },
      controller: {
        docTitle: 'שלט — CSP-GAMES',
        title: 'שלט תנועה',
        heading: 'הפלאפון הוא המחבט',
        connecting: 'מתחבר…',
        noRoom: 'לא מחובר לחדר',
        roomLabel: 'חדר {code}',
        connectedAs: 'מחובר כ{player}',
        howTitle: 'איך חובטים',
        rule1: 'כדור בצד ימין של המגרש → חבטת ימין',
        rule2: 'כדור בצד שמאל של המגרש → חבטת שמאל',
        rule3: 'זווית הפלאפון בסוף החבטה קובעת לאן הכדור נוחת',
        rule4: 'חבטה חזקה יותר = כדור מהיר יותר',
        nameLabel: 'השם שלך',
        namePlaceholder: 'הקלידו שם…',
        saveName: 'שמור',
        nameSaved: 'השם נשמר במכשיר.',
        nameUpdated: 'השם עודכן: {name}',
        enableMotion: 'הפעל שלט תנועה',
        motionActive: 'שלט התנועה פעיל',
        calibrate: 'כיול',
        readyButton: 'אני מוכן',
        readyButtonOn: 'מוכן — לחצו לביטול',
        readyWaitingConnect: 'ממתין לחיבור…',
        readyNeedMotion: 'הפעילו את שלט התנועה, ואז לחצו מוכן.',
        readyWaitingStart: '{player} מוכן — ממתינים להתחלת המשחק.',
        readyPrompt: 'אתם {player}. לחצו מוכן כשאתם רוצים לשחק.',
        handLabel: 'יד דומיננטית',
        handRight: 'ימין',
        handLeft: 'שמאל',
        handSetRight: 'נקבע: יד ימין. חבטו ימינה או שמאלה לפי הצד שהכדור מגיע אליו.',
        handSetLeft: 'נקבע: יד שמאל. חבטו ימינה או שמאלה לפי הצד שהכדור מגיע אליו.',
        practiceButton: 'אימון חבטות',
        practiceButtonOn: 'מצב אימון פעיל',
        practiceTitle: 'אימון חבטות',
        practiceExit: 'יציאה',
        practiceIntro: 'בלי כדור — חובטים ורואים לאן הכדור היה נוחת: צד, כיוון ועוצמה.',
        practiceWaiting: 'ממתין לחבטה…',
        practiceMissed: 'לא זוהה — חבטו חזק יותר',
        practiceRight: 'חבטת ימין',
        practiceLeft: 'חבטת שמאל',
        practiceLanding: 'נחיתה: {place} · עוצמה {power}/5',
        practiceHint: 'זווית הפלאפון בסוף החבטה קובעת אם הכדור הולך לצד הנגדי או לאותו צד.',
        practiceOn: 'מצב אימון: חבטו ותראו לאן הכדור היה הולך.',
        practiceOff: 'מצב האימון כבוי. אפשר לשחק.',
        practiceNeedMotion: 'קודם הפעילו את שלט התנועה.',
        practiceReset: 'אפס מונים',
        aimLabel: 'כיוון נחיתה',
        aimCross: 'צד נגדי',
        aimCenter: 'אמצע',
        aimSame: 'אותו צד',
        countRight: 'ימין',
        countLeft: 'שמאל',
        countSame: 'אותו צד',
        countCross: 'צד נגדי',
        countCenter: 'אמצע',
        scoreLabel: 'ניקוד',
        holdInstruction: 'החזיקו את הפלאפון זקוף ודחפו באלכסון לכיוון מרכז הגוף',
        calibrated: 'כויל! חבטה = דחיפה באלכסון לכיוון מרכז הגוף.',
        motionWaiting: 'ממתין להפעלת שלט תנועה…',
        motionCalibrate: 'לחצו כיול, ואז חבטו כמו במחבט',
        motionPractice: 'מצב אימון · חבטו ותראו לאן הכדור הולך',
        motionReady: 'מוכן — חבטו כשהכדור מגיע אליכם',
        preparingSensors: 'מכין את חיישני התנועה…',
        continueHere: 'המשיכו כאן',
        rescan: 'סרקו שוב את הקוד מהמסך של המשחק.',
        cannotEnableHere: 'לא ניתן להפעיל חיישני תנועה בדף הזה.',
        motionDenied: 'הגישה לתנועה נדחתה. אשרו בחלונית של הדפדפן.',
        motionFailed: 'לא ניתן להפעיל את החיישנים. אשרו את ההרשאה ונסו שוב.',
        scanToConnect: 'סרקו את הקוד מהמסך של המשחק כדי להתחבר.',
        disconnected: 'נותקנו — מתחבר מחדש…',
        screenClosed: 'מסך המשחק נסגר.',
        needMotionFirst: 'קודם הפעילו את שלט התנועה.',
        touchTitle: 'אין תנועה? שחקו במגע',
        touchArea: 'אזור מגע',
        touchHint: 'החליקו ימינה או שמאלה כדי לחבוט',
        touchAria: 'אזור שליטה במגע',
        hudPoint: 'נקודה!',
        hudMiss: 'פספוס — צד לא נכון',
        hudHit: 'פגיעה! עוצמה {power}/5',
        hudSwing: '{side} · {place} · {power}/5',
        hudVsAi: 'מול המחשב — בהצלחה!',
        hudLocal: '2 שחקנים — בהצלחה!',
        hudWins: '{player} ניצח!',
        hudWaiting: 'ממתין',
        themeP1: '{player} · כחול',
        themeP2: '{player} · אדום',
      },
      errors: {
        ROOM_HAS_SCREEN: 'לחדר הזה כבר יש מסך משחק.',
        HOST_FIRST: 'פתחו קודם את המסך הראשון, ואז הצטרפו עם קוד החדר שלו.',
        ROOM_NOT_FOUND: 'החדר לא נמצא. פתחו קודם את המשחק במחשב.',
        SCREEN_NOT_CONNECTED: 'מסך המשחק עוד לא מחובר.',
        ROOM_FULL: 'בחדר הזה כבר יש שני שחקנים.',
        NEED_P1_READY: 'שחקן 1 חייב להיות מחובר ומוכן.',
        NEED_P2_READY: 'שחקן 2 חייב ללחוץ מוכן.',
      },
    },
  };

  const SUPPORTED = Object.keys(DICT);

  function readStored() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null; // private mode
    }
  }

  function writeStored(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (_) {
      /* private mode */
    }
  }

  /**
   * An explicit `?lang=` wins over the saved choice: the screen puts it in the
   * QR link so a scanning phone opens in the same language as the game.
   */
  function detectLang() {
    const fromUrl = new URLSearchParams(location.search).get('lang');
    if (fromUrl && SUPPORTED.includes(fromUrl)) {
      writeStored(fromUrl);
      return fromUrl;
    }

    const stored = readStored();
    if (stored && SUPPORTED.includes(stored)) return stored;

    const nav = (navigator.languages || [navigator.language || ''])
      .join(',')
      .toLowerCase();
    if (/\bhe|\biw/.test(nav)) return 'he';
    return DEFAULT_LANG;
  }

  let current = detectLang();

  function dirFor(lang) {
    return RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
  }

  function lookup(lang, key) {
    const parts = String(key).split('.');
    let node = DICT[lang];
    for (const part of parts) {
      if (node == null || typeof node !== 'object') return undefined;
      node = node[part];
    }
    return typeof node === 'string' ? node : undefined;
  }

  function interpolate(template, params) {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      params[name] == null ? match : String(params[name])
    );
  }

  /** Translate `key`, falling back to English and then to the key itself. */
  function t(key, params) {
    const hit = lookup(current, key) ?? lookup(DEFAULT_LANG, key);
    if (hit == null) {
      console.warn('[i18n] missing key:', key);
      return key;
    }
    return interpolate(hit, params);
  }

  /** Translate a server error, accepting either a code or a ready-made message. */
  function tError(payload, fallbackKey) {
    const code = typeof payload === 'string' ? payload : payload?.code;
    if (code && lookup(current, `errors.${code}`)) return t(`errors.${code}`);
    if (typeof payload?.error === 'string' && payload.error) return payload.error;
    if (typeof payload === 'string' && payload) return payload;
    return t(fallbackKey || 'status.cannotStart');
  }

  const ATTR_BINDINGS = [
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-title', 'title'],
    ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-alt', 'alt'],
  ];

  /** Apply every `data-i18n*` binding inside `root` (defaults to the document). */
  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    ATTR_BINDINGS.forEach(([dataAttr, target]) => {
      scope.querySelectorAll(`[${dataAttr}]`).forEach((el) => {
        el.setAttribute(target, t(el.getAttribute(dataAttr)));
      });
    });
  }

  function applyDocumentLang() {
    const html = document.documentElement;
    html.setAttribute('lang', current);
    html.setAttribute('dir', dirFor(current));
  }

  function setLang(lang, options) {
    if (!SUPPORTED.includes(lang) || lang === current) return;
    current = lang;
    writeStored(lang);
    applyDocumentLang();
    apply();
    syncSwitchers();
    if (!options?.silent) {
      window.dispatchEvent(new CustomEvent('csp:langchange', { detail: { lang } }));
    }
  }

  function other() {
    return current === 'he' ? 'en' : 'he';
  }

  function toggle() {
    setLang(other());
  }

  const switchers = new Set();

  function syncSwitchers() {
    switchers.forEach((btn) => {
      const next = other();
      btn.textContent = DICT[next].lang.short;
      btn.setAttribute('title', DICT[current].lang.switchTo);
      btn.setAttribute('aria-label', DICT[current].lang.switchTo);
    });
  }

  /**
   * Turn every `[data-lang-toggle]` element into a one-tap language switch.
   * Safe to call repeatedly; elements are tracked so labels stay in sync.
   */
  function mountSwitchers(root) {
    (root || document).querySelectorAll('[data-lang-toggle]').forEach((btn) => {
      if (switchers.has(btn)) return;
      switchers.add(btn);
      btn.addEventListener('click', toggle);
    });
    syncSwitchers();
  }

  /**
   * Add the active language to a URL so the phone that scans a QR code opens
   * the controller in the same language as the game screen.
   */
  function withLang(url) {
    try {
      const u = new URL(url, location.origin);
      u.searchParams.set('lang', current);
      return u.toString();
    } catch (_) {
      const sep = String(url).includes('?') ? '&' : '?';
      return `${url}${sep}lang=${current}`;
    }
  }

  applyDocumentLang();

  window.CSPI18n = {
    t,
    tError,
    apply,
    setLang,
    toggle,
    mountSwitchers,
    withLang,
    get lang() {
      return current;
    },
    get dir() {
      return dirFor(current);
    },
    supported: SUPPORTED.slice(),
  };

  document.addEventListener('DOMContentLoaded', () => {
    apply();
    mountSwitchers();
  });
})();
