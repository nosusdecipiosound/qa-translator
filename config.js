// Firebase の設定（Firebase コンソール → プロジェクトの設定 → マイアプリ に表示されるもの）
window.APP_CONFIG = {
  firebase: {
    apiKey: "AIzaSyArl4aG2GXCReENQfmPjBIinBbySJRwcfQ",
    authDomain: "lecture-translator-aeda5.firebaseapp.com",
    databaseURL: "https://lecture-translator-aeda5-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "lecture-translator-aeda5",
    storageBucket: "lecture-translator-aeda5.firebasestorage.app",
    messagingSenderId: "347764079607",
    appId: "1:347764079607:web:d75ae0c55f1627d9974cf2",
    measurementId: "G-NSSPYTDJJJ"
  },

  // URL に ?room=xxx が無いときに使う部屋名
  defaultRoom: "lecture",

  // 参加者のスマホの表示："en" = 英語だけ（画面の文字も会話も英語）、"both" = 日英両方
  // スクリーン用PC（?host）は常に日英両方
  guestDisplay: "en",

  // 画面上部に出るタイトル
  title: "Q&A"
};
