// firebase-config.js
//
// Firebaseコンソール(https://console.firebase.google.com/)で
// プロジェクトを作成した後、「プロジェクトの設定」(歯車アイコン) > 「マイアプリ」で
// ウェブアプリを追加すると表示される設定値を、下の中身と入れ替えてください。
//
// これらの値(apiKeyを含む)はブラウザ上で動くコードに埋め込まれるため
// 誰でも読める状態になりますが、これは仕組み上正常です。Firebaseの実際の
// アクセス制御は「Firestoreのセキュリティルール」(firestore.rules)側で
// 行われます。詳しくはREADME.mdを参照してください。

export const firebaseConfig = {
  apiKey: "AIzaSyDnAi7AEUk2GoP_vJSvvshHaGYmQiW_32o",
  authDomain: "folk-bandroom-booking.firebaseapp.com",
  projectId: "folk-bandroom-booking",
  storageBucket: "folk-bandroom-booking.firebasestorage.app",
  messagingSenderId: "645917817167",
  appId: "1:645917817167:web:54551c61839b5e735e6d3a",
  //measurementId: "G-DT9X23FX8F"
};
