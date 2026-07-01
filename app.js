// app.js
//
// 部室予約アプリのメインロジック。
// fbSdk は firebase-adapter.js が作るオブジェクト(本番)か、
// テスト用のモック(同じ形をしたオブジェクト)のどちらかが渡される。

export function startApp(fbSdk, isConfigured, rootEl){
"use strict";

/* ============================================================
   祝日・営業時間ロジック(検証済み・変更なし)
   ============================================================ */
function nthMonday(year, month, n){
  const d = new Date(year, month - 1, 1);
  const firstDow = d.getDay();
  const firstMonday = 1 + ((1 - firstDow + 7) % 7);
  const day = firstMonday + (n - 1) * 7;
  return new Date(year, month - 1, day);
}
function equinoxDay(year, kind){
  if (kind === 'vernal'){
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
function fmt(y, m, d){
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function computeBaseHolidays(year){
  const map = new Map();
  const add = (y, m, d, name) => map.set(fmt(y, m, d), name);
  add(year, 1, 1, '元日');
  const seijin = nthMonday(year, 1, 2);
  add(year, 1, seijin.getDate(), '成人の日');
  add(year, 2, 11, '建国記念の日');
  add(year, 2, 23, '天皇誕生日');
  add(year, 3, equinoxDay(year, 'vernal'), '春分の日');
  add(year, 4, 29, '昭和の日');
  add(year, 5, 3, '憲法記念日');
  add(year, 5, 4, 'みどりの日');
  add(year, 5, 5, 'こどもの日');
  const umi = nthMonday(year, 7, 3);
  add(year, 7, umi.getDate(), '海の日');
  add(year, 8, 11, '山の日');
  const keirou = nthMonday(year, 9, 3);
  add(year, 9, keirou.getDate(), '敬老の日');
  add(year, 9, equinoxDay(year, 'autumnal'), '秋分の日');
  const sports = nthMonday(year, 10, 2);
  add(year, 10, sports.getDate(), 'スポーツの日');
  add(year, 11, 3, '文化の日');
  add(year, 11, 23, '勤労感謝の日');
  return map;
}
function computeHolidaysWithSubstitutes(year){
  const merged = new Map();
  [year - 1, year, year + 1].forEach(y => {
    computeBaseHolidays(y).forEach((v, k) => merged.set(k, v));
  });
  const dateFromStr = (s) => {
    const parts = s.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  };
  const additions = new Map();
  merged.forEach((_, dateStr) => {
    const d = dateFromStr(dateStr);
    if (d.getDay() === 0){
      let next = new Date(d);
      do {
        next.setDate(next.getDate() + 1);
      } while (merged.has(fmt(next.getFullYear(), next.getMonth() + 1, next.getDate())) ||
               additions.has(fmt(next.getFullYear(), next.getMonth() + 1, next.getDate())));
      additions.set(fmt(next.getFullYear(), next.getMonth() + 1, next.getDate()), '振替休日');
    }
  });
  additions.forEach((v, k) => merged.set(k, v));
  const citizenAdditions = new Map();
  const allDates = Array.from(merged.keys()).sort();
  allDates.forEach(dateStr => {
    const d1 = dateFromStr(dateStr);
    const between = new Date(d1); between.setDate(between.getDate() + 1);
    const betweenStr = fmt(between.getFullYear(), between.getMonth() + 1, between.getDate());
    const after = new Date(between); after.setDate(after.getDate() + 1);
    const afterStr = fmt(after.getFullYear(), after.getMonth() + 1, after.getDate());
    if (!merged.has(betweenStr) && merged.has(afterStr) && between.getDay() !== 0){
      citizenAdditions.set(betweenStr, '国民の休日');
    }
  });
  citizenAdditions.forEach((v, k) => merged.set(k, v));
  return merged;
}
const holidayCache = new Map();
function getHolidayMapForYear(year){
  if (!holidayCache.has(year)) holidayCache.set(year, computeHolidaysWithSubstitutes(year));
  return holidayCache.get(year);
}
function toDateStr(date){ return fmt(date.getFullYear(), date.getMonth() + 1, date.getDate()); }
function getHolidayName(date){
  const map = getHolidayMapForYear(date.getFullYear());
  return map.get(toDateStr(date)) || null;
}
function isHoliday(date){ return getHolidayName(date) !== null; }
function getDayType(date){
  if (date.getDay() === 0 || isHoliday(date)) return 'holiday';
  return 'normal';
}
function getBusinessHours(date){
  const type = getDayType(date);
  return type === 'holiday' ? { startMin: 10 * 60, endMin: 18 * 60 } : { startMin: 8 * 60, endMin: 20 * 60 };
}
function getBookableDateRange(now){
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const extra = now.getHours() >= 20 ? 1 : 0;
  const lastOffset = 13 + extra;
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + lastOffset);
  return { startDate: today, endDate, lastOffset };
}
function mergeIntervals(intervals){
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const merged = [];
  sorted.forEach(([s, e]) => {
    if (merged.length && s <= merged[merged.length - 1][1]){
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else {
      merged.push([s, e]);
    }
  });
  return merged;
}
function getFreeIntervals(businessStart, businessEnd, occupiedIntervals, effectiveStart){
  const lowerBound = Math.max(businessStart, effectiveStart != null ? effectiveStart : businessStart);
  const occupied = mergeIntervals(occupiedIntervals);
  const free = [];
  let cursor = lowerBound;
  occupied.forEach(([s, e]) => {
    if (e <= cursor) return;
    if (s >= businessEnd) return;
    const segStart = Math.max(cursor, lowerBound);
    if (s > segStart) free.push([segStart, Math.min(s, businessEnd)]);
    cursor = Math.max(cursor, e);
  });
  if (cursor < businessEnd) free.push([cursor, businessEnd]);
  return free.filter(([s, e]) => e - s >= 30);
}
function getStartOptions(freeIntervals, slotMin){
  slotMin = slotMin || 30;
  const starts = [];
  freeIntervals.forEach(([s, e]) => {
    for (let t = s; t + slotMin <= e; t += slotMin) starts.push(t);
  });
  return starts;
}
function getMaxDurationAt(startMin, freeIntervals, capMinutes){
  for (const [s, e] of freeIntervals){
    if (startMin >= s && startMin < e) return Math.min(capMinutes, e - startMin);
  }
  return 0;
}
function getDurationOptions(startMin, freeIntervals, capMinutes, slotMin){
  slotMin = slotMin || 30;
  const maxDur = getMaxDurationAt(startMin, freeIntervals, capMinutes);
  const options = [];
  for (let d = slotMin; d <= maxDur; d += slotMin) options.push(d);
  return options;
}
function minutesToHHMM(min){
  const h = Math.floor(min / 60), m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function formatDuration(mins){
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return m + '分';
  if (m === 0) return h + '時間';
  return h + '時間' + m + '分';
}
function roundUpTo30(min){ return Math.ceil(min / 30) * 30; }

/* ============================================================
   設定
   ============================================================ */
const MAX_MIN_PER_BAND_PER_DAY = 120;
const MAX_RESERVATIONS_PER_BAND_IN_WINDOW = 2;
const SLOT_MIN = 30;
const GRID_START_MIN = 8 * 60;
const GRID_END_MIN = 20 * 60;
const WEEKDAY_LABEL = ['日', '月', '火', '水', '木', '金', '土'];
const MIN_PASSWORD_LEN = 6; // Firebase Authenticationの既定要件(6文字以上)に合わせる
const AUTH_EMAIL_DOMAIN = 'clubroom.invalid'; // バンド用の内部識別子として使う架空のメールドメイン

/* ============================================================
   状態
   ============================================================ */
let bands = [];
let reservations = [];

let view = 'register';
let selectedDate = null;
let selectedReservationId = null;
let draftStart = null;
let draftDuration = null;

let unlockedBandId = null;
let authBandSelectId = '';
let authPasswordDraft = '';
let authError = '';

let regNameDraft = '';
let regPasswordDraft = '';
let regPasswordConfirmDraft = '';
let regNoteDraft = '';

let deletingBandId = null;
let deletePasswordDraft = '';
let deleteError = '';

let toast = null;
let connected = false;

function randomLocalPart(){
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ============================================================
   Firestore連携(リアルタイム同期)
   ============================================================ */
function subscribeToData(){
  const bandsCol = fbSdk.collection(fbSdk.db, 'bands');
  fbSdk.onSnapshot(bandsCol, function(snap){
    bands = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    connected = true;
    render();
  }, function(err){
    connected = false;
    console.error('bands onSnapshot error', err);
    render();
  });

  const resosCol = fbSdk.collection(fbSdk.db, 'reservations');
  fbSdk.onSnapshot(resosCol, function(snap){
    reservations = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    connected = true;
    render();
  }, function(err){
    connected = false;
    console.error('reservations onSnapshot error', err);
    render();
  });
}

function showToast(text, isError){
  toast = { text: text, isError: !!isError };
  render();
  setTimeout(() => { toast = null; render(); }, 4200);
}

/* ============================================================
   派生データ計算
   ============================================================ */
function todayStr(){ return toDateStr(new Date()); }

function reservationsOnDate(dateStr){
  return reservations.filter(r => r.date === dateStr).sort((a, b) => a.start - b.start);
}
function bandMinutesOnDate(bandId, dateStr){
  return reservations
    .filter(r => r.bandId === bandId && r.date === dateStr)
    .reduce((sum, r) => sum + (r.end - r.start), 0);
}
function bandFutureReservations(bandId){
  const t = todayStr();
  return reservations.filter(r => r.bandId === bandId && r.date >= t).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}
function bandHasFutureReservations(bandId){
  return bandFutureReservations(bandId).length > 0;
}
function getBookableDates(){
  const range = getBookableDateRange(new Date());
  const dates = [];
  let cur = new Date(range.startDate);
  while (cur <= range.endDate){
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/* ============================================================
   アイコン
   ============================================================ */
function icon(name){
  const common = 'class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const paths = {
    lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>'
  };
  return '<svg ' + common + '>' + (paths[name] || '') + '</svg>';
}

/* ============================================================
   レンダリング
   ============================================================ */
function render(){
  if (!isConfigured){
    rootEl.innerHTML =
      '<div style="max-width:640px;margin:60px auto;padding:24px;font-family:sans-serif;">' +
      '<h1 style="font-size:18px;">Firebaseの設定が未完了です</h1>' +
      '<p>firebase-config.js の値を、あなたのFirebaseプロジェクトのものに書き換えてください。設定するまではデータの保存はできません。</p>' +
      '</div>';
    return;
  }
  rootEl.innerHTML =
    renderHeader() +
    renderTopNav() +
    '<div class="content">' +
      (view === 'register' ? renderRegisterScreen() : renderBookScreen()) +
    '</div>' +
    renderFooterNote() +
    renderToast();
  attachFieldEvents();
}

function renderHeader(){
  return (
    '<div class="app-header"><div class="app-header-inner">' +
      '<div>' +
        '<h1 class="app-title">FOLK部室予約</h1>' +
        '<p class="app-sub">軽音FOLK 部室予約 — 30分単位・当日から2週間先まで予約可</p>' +
      '</div>' +
      '<div class="conn-status"><span class="conn-dot' + (connected ? '' : ' offline') + '"></span>' +
        (connected ? 'リアルタイム同期中' : '接続中...') +
      '</div>' +
    '</div></div>'
  );
}

function renderTopNav(){
  return (
    '<div class="topnav">' +
      '<button class="tab' + (view === 'register' ? ' active' : '') + '" data-action="nav" data-view="register" type="button">バンド登録</button>' +
      '<button class="tab' + (view === 'book' ? ' active' : '') + '" data-action="nav" data-view="book" type="button">予約する</button>' +
    '</div>'
  );
}

/* ---------- 登録画面 ---------- */
function renderRegisterScreen(){
  const rows = bands.length
    ? bands.map(b => renderBandRow(b)).join('')
    : '<p class="empty-note">まだバンドが登録されていません。右のフォームから登録してください。</p>';

  return (
    '<div class="grid-2col">' +
      '<div class="panel"><h2>登録済みバンド</h2>' + rows + '</div>' +
      '<div class="panel">' +
        '<h2>新しくバンドを登録</h2>' +
        '<label for="reg-name">バンド名</label>' +
        '<input id="reg-name" type="text" maxlength="30" value="' + escapeHtml(regNameDraft) + '">' +
        '<label for="reg-password">パスワード(' + MIN_PASSWORD_LEN + '文字以上)</label>' +
        '<input id="reg-password" type="password" maxlength="40" value="' + escapeHtml(regPasswordDraft) + '">' +
        '<label for="reg-password-confirm">パスワード(確認)</label>' +
        '<input id="reg-password-confirm" type="password" maxlength="40" value="' + escapeHtml(regPasswordConfirmDraft) + '">' +
        '<label for="reg-note">メンバー・メモ(任意)</label>' +
        '<input id="reg-note" type="text" maxlength="60" value="' + escapeHtml(regNoteDraft) + '">' +
        '<button class="btn block" type="button" data-action="register-band">登録する</button>' +
        '<p class="hint">パスワードはFirebase Authenticationによって安全に管理され、他の人が読み取ることはできません。予約画面でバンドを選んで操作するときに必要です。</p>' +
      '</div>' +
    '</div>'
  );
}

function renderBandRow(b){
  const hasFuture = bandHasFutureReservations(b.id);
  const isDeleting = deletingBandId === b.id;
  let deleteControl;
  if (hasFuture){
    deleteControl = '<button class="link-btn" type="button" disabled title="今後の予約があるため削除できません">削除</button>';
  } else if (isDeleting){
    deleteControl =
      '<div class="inline-delete">' +
        '<input type="password" id="delete-password-input" placeholder="パスワード" value="' + escapeHtml(deletePasswordDraft) + '">' +
        '<button class="btn small danger" type="button" data-action="confirm-delete-band" data-band-id="' + b.id + '">削除する</button>' +
        '<button class="link-btn" type="button" data-action="cancel-delete-band">やめる</button>' +
      '</div>' +
      (deleteError ? '<div class="msg warn">' + escapeHtml(deleteError) + '</div>' : '');
  } else {
    deleteControl = '<button class="link-btn" type="button" data-action="start-delete-band" data-band-id="' + b.id + '">削除</button>';
  }
  return (
    '<div class="band-row">' +
      '<div><div class="name">' + escapeHtml(b.name) + '</div>' +
      (b.note ? '<div class="note">' + escapeHtml(b.note) + '</div>' : '') + '</div>' +
      '<div>' + (isDeleting ? '' : deleteControl) + '</div>' +
    '</div>' +
    (isDeleting ? deleteControl : '')
  );
}

/* ---------- 予約画面 ---------- */
function renderBookScreen(){
  return (
    '<div class="panel">' +
      '<h2>予約カレンダー</h2>' +
      renderReservationDetail() +
      renderCalendarGrid() +
      renderLegend() +
    '</div>' +
    '<div class="grid-2col">' +
      renderAuthPanel() +
      renderBookingPanel() +
    '</div>'
  );
}

function renderReservationDetail(){
  if (!selectedReservationId) return '';
  const r = reservations.find(x => x.id === selectedReservationId);
  if (!r) return '';
  const parts = r.date.split('-').map(Number);
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  const dateLabel = parts[0] + '年' + parts[1] + '月' + parts[2] + '日(' + WEEKDAY_LABEL[dateObj.getDay()] + ')';
  const canCancel = unlockedBandId === r.bandId;

  return (
    '<div class="reso-detail show">' +
      '<div>' +
        '<div class="rd-band"><span class="rd-dot"></span>' + escapeHtml(r.bandName) + '</div>' +
        '<div class="rd-when">' + dateLabel + '　' + minutesToHHMM(r.start) + ' 〜 ' + minutesToHHMM(r.end) + '</div>' +
      '</div>' +
      '<div class="rd-actions">' +
        (canCancel ? '<button class="link-btn" type="button" data-action="cancel-reservation" data-res-id="' + r.id + '">この予約を取消</button>' : '') +
        '<button class="link-btn" type="button" data-action="close-reservation-detail" aria-label="閉じる">閉じる</button>' +
      '</div>' +
    '</div>'
  );
}

function buildRowSegments(dateStr, dateObj){
  const hours = getBusinessHours(dateObj);
  const dayResos = reservationsOnDate(dateStr);
  const isToday = dateStr === todayStr();
  const nowMin = isToday ? (new Date().getHours() * 60 + new Date().getMinutes()) : null;
  const nowBoundary = isToday ? roundUpTo30(nowMin) : null;

  const segments = [];
  let slot = GRID_START_MIN;
  while (slot < GRID_END_MIN){
    const activeRes = dayResos.find(r => r.start === slot);
    if (activeRes){
      segments.push({ type: 'reserved', span: (activeRes.end - activeRes.start) / SLOT_MIN, res: activeRes });
      slot = activeRes.end;
      continue;
    }
    if (slot < hours.startMin || slot >= hours.endMin){
      segments.push({ type: 'blocked', span: 1 });
      slot += SLOT_MIN;
      continue;
    }
    if (isToday && slot < nowBoundary){
      segments.push({ type: 'past', span: 1 });
      slot += SLOT_MIN;
      continue;
    }
    segments.push({ type: 'free', span: 1, start: slot });
    slot += SLOT_MIN;
  }
  return segments;
}

function renderCalendarGrid(){
  const dates = getBookableDates();
  const totalCols = (GRID_END_MIN - GRID_START_MIN) / SLOT_MIN;

  let header = '<div class="grid-label"></div>';
  for (let h = 8; h < 20; h++){
    header += '<div class="grid-hour-label" style="grid-column:span 2">' + h + ':00</div>';
  }

  let body = '';
  dates.forEach(d => {
    const dStr = toDateStr(d);
    const holidayName = getHolidayName(d);
    const isToday = dStr === todayStr();
    const rowClass = isToday ? ' today-row' : '';
    body += '<div class="grid-label' + rowClass + '">' +
      '<span class="gl-date">' + (d.getMonth() + 1) + '/' + d.getDate() + '</span>' +
      '<span class="gl-dow">(' + WEEKDAY_LABEL[d.getDay()] + ')</span>' +
      (holidayName ? '<span class="gl-holiday" title="' + escapeHtml(holidayName) + '">祝</span>' : '') +
    '</div>';

    const segs = buildRowSegments(dStr, d);
    segs.forEach(seg => {
      if (seg.type === 'blocked'){
        body += '<div class="cell cell-blocked' + rowClass + '" style="grid-column:span 1"></div>';
      } else if (seg.type === 'past'){
        body += '<div class="cell cell-past' + rowClass + '" style="grid-column:span 1"></div>';
      } else if (seg.type === 'free'){
        body += '<div class="cell cell-free' + rowClass + '" style="grid-column:span 1" data-action="grid-pick" data-date="' + dStr + '" data-start="' + seg.start + '" title="' + minutesToHHMM(seg.start) + ' 空き"></div>';
      } else if (seg.type === 'reserved'){
        const r = seg.res;
        body += '<div class="cell cell-reserved" style="grid-column:span ' + seg.span + '" data-action="show-reservation-detail" data-res-id="' + r.id + '" title="' + escapeHtml(r.bandName) + ' ' + minutesToHHMM(r.start) + '-' + minutesToHHMM(r.end) + '">' + escapeHtml(r.bandName) + '</div>';
      }
    });
  });

  return (
    '<div class="grid-wrap"><div class="grid-scroll">' +
      '<div class="cal-grid" style="grid-template-columns:84px repeat(' + totalCols + ', minmax(28px,1fr))">' +
        header + body +
      '</div>' +
    '</div></div>'
  );
}

function renderLegend(){
  return (
    '<div class="legend">' +
      '<span><span class="swatch" style="background:#fff;border:1px solid var(--line)"></span>空き(選択して予約)</span>' +
      '<span><span class="swatch" style="background:var(--reserved-bg);border-left:3px solid var(--reserved-border)"></span>予約済み</span>' +
      '<span><span class="swatch" style="background:var(--block)"></span>休館時間</span>' +
      '<span><span class="swatch" style="background:var(--past-bg)"></span>本日の過去の時間</span>' +
    '</div>'
  );
}

function renderAuthPanel(){
  if (unlockedBandId){
    const band = bands.find(b => b.id === unlockedBandId);
    return (
      '<div class="panel">' +
        '<h2>' + icon('lock') + ' バンドを選んで予約</h2>' +
        '<div class="auth-status">認証中: <strong>' + escapeHtml(band ? band.name : '') + '</strong>' +
          '<button class="link-btn" type="button" data-action="logout">切り替える</button>' +
        '</div>' +
        '<p class="hint">この状態で下のフォームから予約や、自分の予約の取消ができます。</p>' +
      '</div>'
    );
  }

  if (bands.length === 0){
    return '<div class="panel"><h2>' + icon('lock') + ' バンドを選んで予約</h2><p class="empty-note">まだバンドが登録されていません。「バンド登録」タブから登録してください。</p></div>';
  }

  if (!authBandSelectId || !bands.some(b => b.id === authBandSelectId)) authBandSelectId = bands[0].id;
  const options = bands.map(b =>
    '<option value="' + b.id + '"' + (b.id === authBandSelectId ? ' selected' : '') + '>' + escapeHtml(b.name) + '</option>'
  ).join('');

  return (
    '<div class="panel">' +
      '<h2>' + icon('lock') + ' バンドを選んで予約</h2>' +
      '<label for="auth-band-select">バンドを選択</label>' +
      '<select id="auth-band-select">' + options + '</select>' +
      '<label for="auth-password-input">パスワード</label>' +
      '<input id="auth-password-input" type="password" value="' + escapeHtml(authPasswordDraft) + '">' +
      '<button class="btn block" type="button" data-action="unlock-band">認証する</button>' +
      (authError ? '<div class="msg warn">' + escapeHtml(authError) + '</div>' : '') +
      '<p class="hint">予約カレンダーは誰でも見られますが、予約や取消にはバンドごとのパスワードが必要です。</p>' +
    '</div>'
  );
}

function renderBookingPanel(){
  if (!unlockedBandId){
    return '<div class="panel"><h2>予約する</h2><p class="empty-note">左のパネルでバンドを選び、パスワードを入力すると予約できます。</p></div>';
  }
  const band = bands.find(b => b.id === unlockedBandId);
  if (!band){
    return '<div class="panel"><h2>予約する</h2><p class="empty-note">選択中のバンドが見つかりません。再読み込みしてください。</p></div>';
  }

  const dates = getBookableDates();
  if (!selectedDate || !dates.some(d => toDateStr(d) === selectedDate)) selectedDate = toDateStr(dates[0]);
  const parts = selectedDate.split('-').map(Number);
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  const hours = getBusinessHours(dateObj);
  const dayResos = reservationsOnDate(selectedDate);

  const dateOptions = dates.map(d => {
    const dStr = toDateStr(d);
    const label = (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAY_LABEL[d.getDay()] + ')' + (getHolidayName(d) ? ' 祝' : '');
    return '<option value="' + dStr + '"' + (dStr === selectedDate ? ' selected' : '') + '>' + label + '</option>';
  }).join('');

  const futureResos = bandFutureReservations(band.id);
  const blockedByWindowLimit = futureResos.length >= MAX_RESERVATIONS_PER_BAND_IN_WINDOW;

  const occupied = dayResos.map(r => [r.start, r.end]);
  const isToday = selectedDate === todayStr();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const effectiveStart = isToday ? roundUpTo30(nowMin) : null;
  const freeIntervals = getFreeIntervals(hours.startMin, hours.endMin, occupied, effectiveStart);

  const usedToday = bandMinutesOnDate(band.id, selectedDate);
  const remainingCapToday = MAX_MIN_PER_BAND_PER_DAY - usedToday;
  const blockedByDailyCap = remainingCapToday < SLOT_MIN;

  let formBody = '';
  if (blockedByWindowLimit){
    const dateList = futureResos.map(r => r.date.slice(5).replace('-', '/')).join(', ');
    formBody = '<div class="msg warn">' + escapeHtml(band.name) + 'は今後2週間で既に' + MAX_RESERVATIONS_PER_BAND_IN_WINDOW + '件予約済みです(' + dateList + ')。新しく予約するには、既存の予約を1件取り消してください。</div>';
  } else if (blockedByDailyCap){
    formBody = '<div class="msg warn">' + escapeHtml(band.name) + 'はこの日すでに' + formatDuration(usedToday) + 'を予約しています(1バンド1日' + (MAX_MIN_PER_BAND_PER_DAY / 60) + '時間まで)。</div>';
  } else {
    const startOptions = getStartOptions(freeIntervals, SLOT_MIN);
    if (startOptions.length === 0){
      formBody = '<div class="msg warn">この日はもう空き時間がありません。別の日をお試しください。</div>';
    } else {
      if (draftStart == null || startOptions.indexOf(draftStart) === -1) draftStart = startOptions[0];
      const durationOptions = getDurationOptions(draftStart, freeIntervals, remainingCapToday, SLOT_MIN);
      if (draftDuration == null || durationOptions.indexOf(draftDuration) === -1) draftDuration = durationOptions[0] || null;

      const startOpts = startOptions.map(s =>
        '<option value="' + s + '"' + (s === draftStart ? ' selected' : '') + '>' + minutesToHHMM(s) + '</option>'
      ).join('');
      const durOpts = durationOptions.map(d =>
        '<option value="' + d + '"' + (d === draftDuration ? ' selected' : '') + '>' + formatDuration(d) + '</option>'
      ).join('');

      formBody =
        '<div class="form-row">' +
          '<div><label for="start-select">開始時刻</label><select id="start-select">' + startOpts + '</select></div>' +
          '<div><label for="duration-select">利用時間</label><select id="duration-select">' + durOpts + '</select></div>' +
        '</div>' +
        (draftStart != null && draftDuration
          ? '<p class="hint">予約枠: ' + minutesToHHMM(draftStart) + ' 〜 ' + minutesToHHMM(draftStart + draftDuration) + '</p>'
          : '') +
        '<button class="btn block" type="button" data-action="submit-booking"' + (draftStart == null || !draftDuration ? ' disabled' : '') + '>この内容で予約する</button>';
    }
  }

  const myResos = futureResos.map(r =>
    '<div class="reso-item"><span>' + r.date + ' <span class="when">' + minutesToHHMM(r.start) + '-' + minutesToHHMM(r.end) + '</span></span>' +
      '<button class="link-btn" type="button" data-action="cancel-reservation" data-res-id="' + r.id + '">取消</button>' +
    '</div>'
  ).join('');

  return (
    '<div class="panel">' +
      '<h2>予約する</h2>' +
      '<label for="date-select">日付</label>' +
      '<select id="date-select">' + dateOptions + '</select>' +
      formBody +
      '<div style="margin-top:20px; border-top:1px solid var(--line); padding-top:14px;">' +
        '<h2 style="font-size:14px;">' + escapeHtml(band.name) + 'の今後の予約</h2>' +
        (myResos || '<p class="empty-note">今後の予約はありません。</p>') +
      '</div>' +
    '</div>'
  );
}

function renderFooterNote(){
  return (
    '<div class="footer-note">' +
      '<strong>利用ルール:</strong> 平日・土曜は8:00-20:00、日曜・祝日は10:00-18:00に利用できます。' +
      '予約は30分単位、1バンド1日最大2時間まで。予約可能な期間は当日から2週間先までで、毎日20:00に翌日分が新たに解放されます。' +
      '各バンドはこの2週間の範囲内で最大2件まで予約できます。祝日は法律に基づく算出ロジックで自動判定しています(振替休日・国民の休日を含む)。' +
      'パスワードはFirebase Authenticationで安全に管理されます。データはFirestoreのセキュリティルールにより、各バンドが自分自身の予約のみ作成・削除できるように保護されています。' +
      '複数人が同時に操作すると、ごく稀に表示のずれが生じる場合があります。おかしいと感じたら再読み込みしてください。' +
    '</div>'
  );
}

function renderToast(){
  if (!toast) return '';
  return '<div class="toast' + (toast.isError ? ' error' : '') + '">' + escapeHtml(toast.text) + '</div>';
}

function escapeHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ============================================================
   フィールドイベント
   ============================================================ */
function attachFieldEvents(){
  bindInput('reg-name', v => { regNameDraft = v; });
  bindInput('reg-password', v => { regPasswordDraft = v; });
  bindInput('reg-password-confirm', v => { regPasswordConfirmDraft = v; });
  bindInput('reg-note', v => { regNoteDraft = v; });
  bindInput('delete-password-input', v => { deletePasswordDraft = v; });
  bindInput('auth-password-input', v => { authPasswordDraft = v; });

  const authBandSelect = rootEl.querySelector('#auth-band-select');
  if (authBandSelect) authBandSelect.addEventListener('change', e => { authBandSelectId = e.target.value; });

  const dateSelect = rootEl.querySelector('#date-select');
  if (dateSelect) dateSelect.addEventListener('change', e => {
    selectedDate = e.target.value; draftStart = null; draftDuration = null; render();
  });
  const startSelect = rootEl.querySelector('#start-select');
  if (startSelect) startSelect.addEventListener('change', e => {
    draftStart = Number(e.target.value); draftDuration = null; render();
  });
  const durSelect = rootEl.querySelector('#duration-select');
  if (durSelect) durSelect.addEventListener('change', e => {
    draftDuration = Number(e.target.value); render();
  });
}
function bindInput(id, onChange){
  const el = rootEl.querySelector('#' + id);
  if (!el) return;
  el.addEventListener('input', e => { onChange(e.target.value); });
}

/* ============================================================
   クリック委譲(初回のみ登録)
   ============================================================ */
let delegatedClickAttached = false;
function attachDelegatedClickOnce(){
  if (delegatedClickAttached) return;
  delegatedClickAttached = true;

  rootEl.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;

    if (action === 'nav'){
      view = el.dataset.view;
      authError = ''; deleteError = ''; deletingBandId = null;
      render();
    } else if (action === 'register-band'){
      await handleRegisterBand();
    } else if (action === 'start-delete-band'){
      deletingBandId = el.dataset.bandId; deletePasswordDraft = ''; deleteError = ''; render();
    } else if (action === 'cancel-delete-band'){
      deletingBandId = null; deletePasswordDraft = ''; deleteError = ''; render();
    } else if (action === 'confirm-delete-band'){
      await handleDeleteBand(el.dataset.bandId);
    } else if (action === 'unlock-band'){
      await handleUnlockBand();
    } else if (action === 'logout'){
      await fbSdk.signOut(fbSdk.auth);
      unlockedBandId = null; draftStart = null; draftDuration = null; render();
    } else if (action === 'grid-pick'){
      selectedDate = el.dataset.date; draftStart = Number(el.dataset.start); draftDuration = null;
      render();
      if (!unlockedBandId) showToast('予約するには、下のパネルでバンドを選んでパスワードを入力してください。');
    } else if (action === 'show-reservation-detail'){
      selectedReservationId = el.dataset.resId;
      render();
      const detailEl = rootEl.querySelector('.reso-detail');
      if (detailEl && typeof detailEl.scrollIntoView === 'function'){
        const reduceMotion = typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        detailEl.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
      }
    } else if (action === 'close-reservation-detail'){
      selectedReservationId = null; render();
    } else if (action === 'submit-booking'){
      await handleSubmitBooking();
    } else if (action === 'cancel-reservation'){
      selectedReservationId = null;
      await handleCancelReservation(el.dataset.resId);
    }
  });
}

/* ============================================================
   ハンドラ(Firebase Authentication + Firestore)
   ============================================================ */
async function handleRegisterBand(){
  const name = regNameDraft.trim();
  const pw = regPasswordDraft;
  const pwConfirm = regPasswordConfirmDraft;

  if (!name){ showToast('バンド名を入力してください。', true); return; }
  if (pw.length < MIN_PASSWORD_LEN){ showToast('パスワードは' + MIN_PASSWORD_LEN + '文字以上で設定してください。', true); return; }
  if (pw !== pwConfirm){ showToast('パスワード(確認)が一致しません。', true); return; }

  const dup = bands.some(b => b.name.toLowerCase() === name.toLowerCase());
  if (dup){ showToast('この名前のバンドは既に登録されています。', true); return; }

  const authEmail = randomLocalPart() + '@' + AUTH_EMAIL_DOMAIN;

  try {
    const cred = await fbSdk.createUserWithEmailAndPassword(fbSdk.auth, authEmail, pw);
    const uid = cred.user.uid;
    await fbSdk.setDoc(fbSdk.doc(fbSdk.db, 'bands', uid), {
      name: name, nameLower: name.toLowerCase(), note: regNoteDraft.trim(),
      authEmail: authEmail, createdAt: fbSdk.serverTimestamp(),
    });
    await fbSdk.signOut(fbSdk.auth); // 登録直後は自動ログインさせず、明示的な認証操作に統一する
    regNameDraft = ''; regPasswordDraft = ''; regPasswordConfirmDraft = ''; regNoteDraft = '';
    showToast(name + ' を登録しました。');
  } catch (e) {
    showToast('登録に失敗しました: ' + describeAuthError(e), true);
  }
}

async function handleDeleteBand(id){
  const band = bands.find(b => b.id === id);
  if (!band){ deletingBandId = null; render(); return; }
  if (bandHasFutureReservations(id)){
    deleteError = 'このバンドには今後の予約があるため削除できません。';
    render(); return;
  }
  try {
    // パスワードの正しさは「そのパスワードでサインインできるか」で検証する
    // (パスワードそのものはこちらで保持・比較しない。Firebaseにすべて委ねる)
    const cred = await fbSdk.signInWithEmailAndPassword(fbSdk.auth, band.authEmail, deletePasswordDraft);
    await fbSdk.deleteDoc(fbSdk.doc(fbSdk.db, 'bands', id));
    await fbSdk.deleteUser(cred.user);
    if (unlockedBandId === id) unlockedBandId = null;
    deletingBandId = null; deletePasswordDraft = ''; deleteError = '';
    showToast(band.name + ' を削除しました。');
  } catch (e) {
    deleteError = 'パスワードが正しくありません。';
    render();
  }
}

async function handleUnlockBand(){
  const band = bands.find(b => b.id === authBandSelectId);
  if (!band){ authError = 'バンドが見つかりません。再読み込みしてください。'; render(); return; }
  try {
    await fbSdk.signInWithEmailAndPassword(fbSdk.auth, band.authEmail, authPasswordDraft);
    unlockedBandId = band.id;
    authPasswordDraft = ''; authError = '';
    draftStart = null; draftDuration = null;
    render();
  } catch (e) {
    authError = 'パスワードが正しくありません。';
    render();
  }
}

let bookingInFlight = false;
async function handleSubmitBooking(){
  if (bookingInFlight) return;
  if (draftStart == null || !draftDuration) return;
  bookingInFlight = true;
  try {
    const dateStr = selectedDate;
    const band = bands.find(b => b.id === unlockedBandId);
    if (!band || !fbSdk.auth.currentUser){
      showToast('認証状態が失われました。再度パスワードを入力してください。', true); unlockedBandId = null; render(); return;
    }

    const parts = dateStr.split('-').map(Number);
    const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
    const hours = getBusinessHours(dateObj);
    const range = getBookableDateRange(new Date());
    if (dateObj < range.startDate || dateObj > range.endDate){
      showToast('この日付は現在予約可能な期間外です。画面を更新してください。', true); render(); return;
    }

    const futureResos = bandFutureReservations(band.id);
    if (futureResos.length >= MAX_RESERVATIONS_PER_BAND_IN_WINDOW){
      showToast(band.name + 'は既に上限件数の予約をしています。', true); render(); return;
    }

    const usedToday = bandMinutesOnDate(band.id, dateStr);
    if (usedToday + draftDuration > MAX_MIN_PER_BAND_PER_DAY){
      showToast('この日の利用時間が1バンドの上限(' + (MAX_MIN_PER_BAND_PER_DAY / 60) + '時間)を超えます。', true); render(); return;
    }

    const start = draftStart, end = draftStart + draftDuration;
    if (start < hours.startMin || end > hours.endMin){
      showToast('選択した時間帯が利用可能時間の範囲外です。', true); render(); return;
    }

    const occupied = reservationsOnDate(dateStr);
    const overlap = occupied.some(r => start < r.end && end > r.start);
    if (overlap){
      showToast('選択した時間帯は別のバンドの予約と重なりました。画面を更新して選び直してください。', true);
      render(); return;
    }

    await fbSdk.addDoc(fbSdk.collection(fbSdk.db, 'reservations'), {
      bandId: band.id, bandName: band.name, date: dateStr,
      start: start, end: end, createdAt: fbSdk.serverTimestamp(),
    });
    draftStart = null; draftDuration = null;
    showToast(band.name + 'の予約を確定しました(' + dateStr + ' ' + minutesToHHMM(start) + '-' + minutesToHHMM(end) + ')。');
  } catch (e) {
    showToast('予約に失敗しました: ' + e.message, true);
  } finally {
    bookingInFlight = false;
  }
}

let cancelInFlight = false;
async function handleCancelReservation(id){
  if (cancelInFlight) return;
  cancelInFlight = true;
  try {
    const res = reservations.find(r => r.id === id);
    if (!res){ render(); return; }
    if (res.bandId !== unlockedBandId){
      showToast('このバンドで認証していないため取消できません。', true); render(); return;
    }
    await fbSdk.deleteDoc(fbSdk.doc(fbSdk.db, 'reservations', id));
    showToast(res.bandName + 'の予約(' + res.date + ' ' + minutesToHHMM(res.start) + '-' + minutesToHHMM(res.end) + ')を取り消しました。');
  } catch (e) {
    showToast('取消に失敗しました: ' + e.message, true);
  } finally {
    cancelInFlight = false;
  }
}

function describeAuthError(e){
  const code = (e && e.code) || '';
  if (code.indexOf('weak-password') !== -1) return 'パスワードが短すぎます。';
  if (code.indexOf('email-already-in-use') !== -1) return '内部エラー(識別子の重複)。もう一度お試しください。';
  return (e && e.message) ? e.message : '不明なエラー';
}

/* ============================================================
   初期化
   ============================================================ */
attachDelegatedClickOnce();
if (isConfigured){
  fbSdk.onAuthStateChanged(fbSdk.auth, function(user){
    unlockedBandId = user ? user.uid : null;
    render();
  });
  subscribeToData();
}
render();

} // startApp
