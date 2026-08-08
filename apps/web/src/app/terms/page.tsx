import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "利用規約 | まとめて寄れる店検索" };

export default function TermsPage() {
  return <main className="policy-page">
    <Link className="policy-back" href="/">← 店舗検索へ戻る</Link>
    <h1>利用規約</h1>
    <p>本規約は「まとめて寄れる店検索」（以下「本サービス」）の利用条件を定めるものです。本サービスを利用した時点で、本規約に同意したものとみなします。</p>
    <h2>サービス内容</h2>
    <p>本サービスは、指定されたチェーンの店舗・施設・徒歩経路に関する候補を外部の地図データとAPIから検索して表示します。検索結果は参考情報であり、店舗の営業、入居、移転、閉店、経路の安全性や通行可能性を保証しません。来訪前に各店舗や施設の公式情報を確認してください。</p>
    <h2>外部サービス</h2>
    <p>本サービスはGoogle Maps Platformを利用します。利用には、<a href="https://cloud.google.com/maps-platform/terms" target="_blank" rel="noreferrer">Google Maps Platform利用規約</a>およびGoogleが定める関連ポリシーも適用されます。</p>
    <h2>禁止事項</h2>
    <ul><li>本サービスまたは外部APIへ過度な負荷を与える行為</li><li>不正アクセス、機能の妨害、法令または第三者の権利を侵害する行為</li><li>検索結果や外部データを、それぞれの提供元の条件に反して取得・保存・再配布する行為</li></ul>
    <h2>免責と変更</h2>
    <p>運営者は、本サービスの正確性、完全性、継続提供を保証せず、利用によって生じた損害について、法令上認められる範囲で責任を負いません。本サービスや本規約は、必要に応じて変更または停止されることがあります。</p>
    <p>制定日: 2026年8月2日</p>
  </main>;
}
