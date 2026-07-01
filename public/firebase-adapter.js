// firebase-adapter.js
//
// Firebase SDK(公式CDN配布のモジュール版)を読み込み、
// このアプリが使う関数だけをまとめたオブジェクトを作る。
// テスト時にはこのファイルを使わず、同じ形をしたモックを直接
// app.js の startApp() に渡すことで、実際のFirebaseに接続せずに
// アプリのロジックだけを検証できるようにしている。

import { firebaseConfig, requiredEmailDomain } from './firebase-config.js';

const SDK_VERSION = '10.13.2';
const BASE = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/';

export const FIREBASE_CONFIG_IS_SET =
  !!firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY';

export async function createFirebaseAdapter(){
  if (!FIREBASE_CONFIG_IS_SET){
    return null; // 未設定の場合はnullを返し、呼び出し側でセットアップ案内を表示する
  }

  const appMod = await import(BASE + 'firebase-app.js');
  const authMod = await import(BASE + 'firebase-auth.js');
  const storeMod = await import(BASE + 'firebase-firestore.js');

  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  const db = storeMod.getFirestore(app);

  const googleProvider = new authMod.GoogleAuthProvider();
  if (requiredEmailDomain && requiredEmailDomain !== 'YOUR_SCHOOL_DOMAIN'){
    // アカウント選択画面で自校のGoogle Workspaceアカウントを選びやすくするヒント。
    // あくまでUX上のヒントであり、実際のアクセス制御はfirestore.rules側で行う。
    googleProvider.setCustomParameters({ hd: requiredEmailDomain });
  }

  return {
    auth: auth,
    db: db,
    requiredEmailDomain: requiredEmailDomain,
    signInWithPopup: (a) => authMod.signInWithPopup(a, googleProvider),
    signOut: authMod.signOut,
    onAuthStateChanged: authMod.onAuthStateChanged,
    collection: storeMod.collection,
    doc: storeMod.doc,
    setDoc: storeMod.setDoc,
    addDoc: storeMod.addDoc,
    deleteDoc: storeMod.deleteDoc,
    onSnapshot: storeMod.onSnapshot,
    serverTimestamp: storeMod.serverTimestamp,
  };
}
