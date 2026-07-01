# 部室予約システム(Firebase版)

軽音楽部の部室予約Webアプリです。GitHub Pagesなどの静的ホスティングで公開し、
データの保存・認証にはFirebase(無料枠)を使います。

> このREADMEの手順どおりに進めれば、GitHubの操作に慣れている方なら
> 30分〜1時間程度で公開できるはずです。

---

## 0. ファイル構成

```
index.html            # 読み込み専用のごく薄いシェル(編集不要)
firebase-config.js     # ★あなたが編集する唯一のファイル(Firebaseの接続情報)
firebase-adapter.js    # Firebase SDKの読み込み・ラップ(編集不要)
app.js                 # アプリ本体のロジック(編集不要)
firestore.rules        # Firestoreのセキュリティルール(Firebaseコンソールに貼る)
test/                  # 動作確認用のテストコード(公開サイトには不要、削除してよい)
```

公開に必要なのは `index.html` `firebase-config.js` `firebase-adapter.js` `app.js` の4つです。
`test/` フォルダはローカルでの動作確認用なので、GitHub Pagesにアップロードしなくても問題ありません(あっても害はありません)。

---

## 1. Firebaseプロジェクトを作る

1. https://console.firebase.google.com/ を開き、Googleアカウントでログイン。
2. 「プロジェクトを追加」→ 名前を入力(例: `bandroom-booking`)→ Google アナリティクスは不要なのでオフでよい → 作成。

## 2. Authentication(認証)を有効化する

1. 左メニュー「Authentication」→「始める」。
2. 「Sign-in method」タブ →「メール/パスワード」を選択 →「有効にする」→ 保存。
   *(これを忘れると、バンド登録・ログインが一切動きません)*

## 3. Firestore Database を作る

1. 左メニュー「Firestore Database」→「データベースの作成」。
2. ロケーションは `asia-northeast1`(東京)など、日本に近いものを選択。
3. モードは「本番環境モード」を選択(下の手順4で正式なルールを設定するため)。

## 4. セキュリティルールを設定する

1. 「Firestore Database」→「ルール」タブを開く。
2. このリポジトリの `firestore.rules` の内容を**全部コピー**して、エディタの内容を丸ごと置き換える。
3. 「公開」をクリック。

このルールにより、以下がFirebase側(サーバー側)で強制されます。

- カレンダーの閲覧は誰でも可能。
- バンドの登録・削除は、そのバンド自身(パスワードで認証した本人)のみ。
- 予約の作成は、認証済みの本人が「自分のバンド名義」でのみ可能。他のバンドを名乗って予約することはできない。
- 予約の取消は、その予約を作ったバンド自身のみ可能。
- 予約は30分単位・最大2時間までという制約もここで強制。

*(「2週間で最大2件」「時間帯の重複禁止」「祝日の営業時間」は複数の予約をまたいで判定する必要があり、Firestoreルールだけでは効率的に検証できないため、引き続きアプリ側(app.js)でチェックしています。悪意ある人が自分のバンド名義で規則を無視した予約を作ることは技術的には可能ですが、他人になりすます・他人の予約を消す・任意のデータを書き込むことはできません。)*

## 5. ウェブアプリを登録し、設定値を取得する

1. Firebaseコンソールのトップ(プロジェクトの概要)→ `</>` (ウェブ)のアイコンをクリック。
2. アプリ名を入力(例: `bandroom-web`)→ Firebase Hostingの設定はスキップしてよい → 登録。
3. 表示される `firebaseConfig = { apiKey: ..., authDomain: ..., ... }` の中身をコピー。
4. このリポジトリの `firebase-config.js` を開き、`YOUR_API_KEY` などのプレースホルダーを、コピーした値に置き換えて保存。

```js
export const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "bandroom-booking.firebaseapp.com",
  projectId: "bandroom-booking",
  storageBucket: "bandroom-booking.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456",
};
```

> `apiKey` を含むこれらの値は、ブラウザで動くコードに埋め込まれる時点で
> 誰でも読める状態になります。これはFirebaseの仕組み上正常で、秘密鍵ではありません。
> 実際のアクセス制御は手順4で設定した「Firestoreのセキュリティルール」が担います。

## 6. GitHubリポジトリにpushして、GitHub Pagesで公開する

```bash
git init
git add index.html firebase-config.js firebase-adapter.js app.js firestore.rules README.md
git commit -m "部室予約システムを追加"
git branch -M main
git remote add origin https://github.com/hajime-18/folk-room-booking.git
git push -u origin main
```

その後、GitHubのリポジトリページで:

1. 「Settings」→「Pages」。
2. 「Build and deployment」の「Source」を `Deploy from a branch` に。
3. 「Branch」を `main` / `/ (root)` に設定して保存。
4. 数十秒〜数分後、`https://hajime-18.github.io/folk-room-booking/` でアクセス可能になります。

---

## 7. 本番投入前に必ず確認すること

100人に展開する前に、**最低でも2〜3人の実際の部員に試してもらってください**。特に以下を確認してください。

- [ ] 自分以外の端末・ブラウザから、公開したURLでバンド登録ができる
- [ ] 別の端末で登録したバンドが、自分の画面のカレンダー・登録一覧にも反映される(リアルタイム同期)
- [ ] 無料のGoogleアカウントを持っていない部員(Claudeの話ではなく、Googleアカウント自体の有無)でも問題なく使える
      → このアプリ自体はGoogleアカウントへのログインを求めません(バンドごとの独自パスワードのみ)。念のため確認してください。
- [ ] パスワードを間違えるとログインできず、正しいパスワードでログインできる
- [ ] 自分のバンドの予約は取消できるが、他のバンドの予約には取消ボタンが出ない

## 8. 運用上の注意(正直な限界)

- **本当に強制されるのは**: 他人になりすませない・他人の予約を消せない・データの形式が壊れない、という部分です。
- **強制されていないのは**: 「2週間で最大2件」「時間帯の重複」「祝日の営業時間」といった業務ルールです。これらはブラウザ側のコードでチェックしていますが、技術に詳しい人がブラウザの開発者ツールなどを使えば、**自分のバンド名義に限り**これらの制限をすり抜けて予約を作ることは可能です。実運用上は「たまに規則を超えて自分のバンドが予約してしまう」程度のリスクとして許容できるかどうかがポイントです。気になる場合は、Cloud Functions(Firebaseの有料枠が前提)を使った完全な検証も別途ご相談ください。
- Firestore・Authenticationとも無料枠(Sparkプラン)で、部活の利用規模(100人・1日数件の予約)であれば費用が発生することはまずありません。
