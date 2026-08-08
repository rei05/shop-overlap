import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "プライバシーポリシー | まとめて寄れる店検索" };

export default function PrivacyPage() {
  return <main className="policy-page">
    <Link className="policy-back" href="/">← 店舗検索へ戻る</Link>
    <h1>プライバシーポリシー</h1>
    <p>本サービスで取り扱う情報と、その利用目的を説明します。</p>
    <h2>取り扱う情報</h2>
    <ul><li>入力した地名、住所、チェーン名、検索中心座標、検索半径などの検索条件</li><li>現在地機能を許可した場合の位置座標。ブラウザから取得し、検索中心として使用します</li><li>IPアドレス、日時、ブラウザ情報など、配信基盤や外部APIが通信時に通常取得するログ情報</li></ul>
    <h2>利用目的と保存</h2>
    <p>これらの情報は、地図表示、店舗検索、徒歩時間・経路計算、不正利用防止、障害調査のために使用します。本サービスはアカウント機能や検索履歴データベースを持ちません。Google Maps Platformの検索結果本体を永続保存またはTTLキャッシュせず、同時に発生した同一リクエストの集約だけを行います。</p>
    <h2>外部サービスへの送信</h2>
    <p>検索条件や座標はCloudflareおよびGoogle Maps Platformへ送信されます。Googleによる情報の取り扱いは<a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Googleプライバシーポリシー</a>もご確認ください。各提供元のログ保存期間やCookie等は、それぞれのポリシーに従います。</p>
    <h2>位置情報</h2>
    <p>現在地は利用者がブラウザで許可した場合だけ取得します。許可を拒否しても、地名入力や地図クリックで本サービスを利用できます。許可はブラウザ設定からいつでも変更できます。</p>
    <h2>改定</h2>
    <p>機能や利用サービスの変更に応じて、本ポリシーを改定することがあります。</p>
    <p>制定日: 2026年8月2日</p>
  </main>;
}
