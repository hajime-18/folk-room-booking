import { JSDOM } from 'jsdom';
import nodeCrypto from 'crypto';
import { startApp } from '../app.js';
import { createFakeFirebase } from './fake-firebase.js';

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function main(){
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  // Node 20+ は global.crypto を既定で持つため、上書きせずそのまま利用する。

  const rootEl = dom.window.document.getElementById('app');
  const fb = createFakeFirebase();

  startApp(fb, true, rootEl);
  await sleep(50);

  function setVal(id, value){
    const el = rootEl.querySelector('#' + id);
    if (!el) throw new Error('not found: ' + id);
    el.value = value;
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  }
  function click(selector){
    const el = rootEl.querySelector(selector);
    if (!el) throw new Error('not clickable: ' + selector);
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  }

  console.log('--- 初期表示 ---');
  console.assert(rootEl.querySelector('.tab.active').dataset.view === 'register', 'デフォルトタブが登録画面でない');
  console.log('[OK]');

  console.log('\n--- バンド登録(Firebase Authでユーザー作成) ---');
  setVal('reg-name', 'テストズ');
  setVal('reg-password', 'abc123');
  setVal('reg-password-confirm', 'abc123');
  click('[data-action="register-band"]');
  await sleep(50);
  console.assert(fb._debug.bandsData.size === 1, 'bandsコレクションに保存されていない');
  console.assert(fb._debug.usersByEmail.size === 1, 'Firebase Authにユーザーが作成されていない');
  console.assert(!fb.auth.currentUser, '登録後は自動的にログアウトしているはず');
  console.log('[OK] Firebase Authユーザー作成 + Firestoreへの保存が成功、登録後はサインアウト状態');

  console.log('\n--- 重複バンド名の拒否 ---');
  setVal('reg-name', 'テストズ');
  setVal('reg-password', 'xyz999');
  setVal('reg-password-confirm', 'xyz999');
  click('[data-action="register-band"]');
  await sleep(50);
  console.assert(fb._debug.bandsData.size === 1, '重複登録されてしまった');
  console.log('[OK] 重複登録は拒否された');

  console.log('\n--- 予約画面: 間違ったパスワードでの認証拒否 ---');
  click('[data-action="nav"][data-view="book"]');
  await sleep(30);
  setVal('auth-password-input', 'wrongpass');
  click('[data-action="unlock-band"]');
  await sleep(50);
  console.assert(rootEl.querySelector('.msg.warn') && rootEl.querySelector('.msg.warn').textContent.includes('正しくありません'), '誤りパスワードのエラーが出ていない');
  console.log('[OK] 誤ったパスワードは拒否された');

  console.log('\n--- 正しいパスワードで認証成功 ---');
  setVal('auth-password-input', 'abc123');
  click('[data-action="unlock-band"]');
  await sleep(50);
  console.assert(fb.auth.currentUser, 'Firebase Authにサインインしていない');
  console.assert(rootEl.innerHTML.includes('認証中'), 'UI上で認証状態が反映されていない');
  console.log('[OK] Firebase Authで認証成功、UIにも反映された');

  console.log('\n--- 予約を作成 ---');
  const freeCell = rootEl.querySelector('.cell-free[data-action="grid-pick"]');
  console.assert(freeCell, '空きセルが見つからない');
  freeCell.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  click('[data-action="submit-booking"]');
  await sleep(50);
  console.assert(fb._debug.reservationsData.size === 1, 'reservationsコレクションに保存されていない');
  const [[resId, resData]] = Array.from(fb._debug.reservationsData.entries());
  console.assert(resData.bandId === fb.auth.currentUser.uid, '予約のbandIdが認証中のuidと一致していない');
  console.log('[OK] 予約がFirestoreに保存された:', JSON.stringify(resData));

  console.log('\n--- 予約セルクリックで詳細表示 ---');
  const reservedCell = rootEl.querySelector('.cell-reserved[data-action="show-reservation-detail"]');
  console.assert(reservedCell, '予約済みセルが見つからない');
  reservedCell.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  console.assert(rootEl.querySelector('.reso-detail'), '詳細パネルが表示されていない');
  console.log('[OK] 詳細パネル表示成功');

  console.log('\n--- 別バンドは他人の予約を削除できない(セキュリティルール相当のチェック) ---');
  await fb.signOut();
  try {
    await fb.deleteDoc(fb.doc(fb.db, 'reservations', resId));
    console.log('[NG] 未認証なのに削除できてしまった');
  } catch (e) {
    console.log('[OK] 未認証状態からの削除は拒否された:', e.code);
  }

  console.log('\n--- 認証済みバンド自身は予約を取消できる ---');
  setVal('auth-password-input', 'abc123');
  click('[data-action="unlock-band"]');
  await sleep(50);
  click('[data-action="cancel-reservation"]');
  await sleep(50);
  console.assert(fb._debug.reservationsData.size === 0, '認証済みバンドによる予約取消が機能していない');
  console.log('[OK] 認証済みバンドによる取消が成功');

  console.log('\n--- 予約が残っているバンドは削除できない/いないバンドは削除できる ---');
  click('[data-action="nav"][data-view="register"]');
  await sleep(30);
  click('[data-action="start-delete-band"]');
  await sleep(20);
  setVal('delete-password-input', 'wrongpass');
  click('[data-action="confirm-delete-band"]');
  await sleep(50);
  console.assert(rootEl.innerHTML.includes('パスワードが正しくありません'), '誤ったパスワードでの削除拒否メッセージが出ていない');
  console.assert(fb._debug.bandsData.size === 1, '誤ったパスワードで削除されてしまった');

  setVal('delete-password-input', 'abc123');
  click('[data-action="confirm-delete-band"]');
  await sleep(50);
  console.assert(fb._debug.bandsData.size === 0, '正しいパスワードでも削除されなかった');
  console.assert(fb._debug.usersByEmail.size === 0, 'Firebase Authのユーザーも削除されているはず');
  console.log('[OK] バンド削除(Firestore文書 + Authユーザーの両方)が成功');

  console.log('\n--- すべてのテスト完了 ---');
}

main().catch(e => { console.error('テスト失敗:', e); process.exit(1); });
