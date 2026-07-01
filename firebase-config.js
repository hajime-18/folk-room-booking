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
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
