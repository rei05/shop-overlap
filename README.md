# まとめて寄れる店検索

指定した2〜5件のチェーンが同じ商業施設に入っている場所、または設定時間内に徒歩で回れる組み合わせを探す、日本国内向けのiOSアプリです。SwiftUIクライアントは、Google Maps Platformのサーバー用キーを保持するCloudflare Worker APIを利用します。

## リポジトリ構成

```text
apps/
  ios/                       SwiftUI iOSアプリ
  api/                       Cloudflare Worker API
    src/domain/              検索制約、入力検証、地理・徒歩探索ロジック
    src/services/            ユースケースの組み立て
    src/providers/google/    Places / Routes APIアダプター
    src/http/                HTTPエラー、本文、キャッシュ処理
packages/
  api-contract/              OpenAPI、生成TypeScript型、Swift Package
  chain-catalog/             日本向けチェーンカタログと生成スクリプト
```

Node側はnpm workspacesです。iOSはXcodeプロジェクトから `packages/api-contract` をローカルSwift Packageとして参照します。スクリプトは生成物の所有パッケージに置き、ルートの `package.json` はワークスペースへの委譲と検証フローだけを定義します。

## Google Cloudの準備

課金を有効にしたGoogle Cloudプロジェクトで次を有効化します。

- Maps SDK for iOS
- Places API (New)
- Routes API

用途別に2つのキーを作成してください。

- サーバー用: Places API (New) とRoutes APIだけを許可し、Worker secret `GOOGLE_MAPS_API_KEY` に登録
- iOS用: Maps SDK for iOSだけを許可し、Bundle ID `jp.shopoverlap.app`（変更する場合は設定も同期）でアプリ制限

iOS用キーはクライアントへ配布されるため、制限なしのサーバー用キーと共用しません。

## ローカル開発

Node.js 22以降とXcode 26以降を用意します。

```bash
npm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
cp apps/ios/Config/Secrets.xcconfig.example apps/ios/Config/Secrets.xcconfig
```

`apps/api/.dev.vars` にサーバー用キー、`Secrets.xcconfig` にBundle ID制限済みのiOS用キーを設定します。その後、次の1コマンドでWorker起動、Simulatorの準備、ビルド、インストール、アプリ起動まで実行できます。

```bash
npm run ios:dev
```

`ios:dev` は `ShopOverlap iPhone` というiPhone 17e Simulatorを再利用し、なければ最新の互換iOSランタイム上に作成します。Workerは動作確認中そのまま稼働し、`Ctrl+C` で停止します。Workerを別ターミナルで起動済みの場合は `npm run ios:run` だけでもアプリを再ビルド・起動できます。DebugのAPI URLは既定で `http://127.0.0.1:8787` です。

本番API URLと規約ページを置く公開サイトのURLも `Secrets.xcconfig` で設定します。

Webアプリは提供しません。利用規約とプライバシーポリシーは `LEGAL_BASE_URL` 配下の `/terms` と `/privacy` に別途公開します。未設定時、iOSアプリはこれらのリンクを表示しません。

## 開発コマンド

```bash
npm run verify              # 契約・カタログ整合、型検査、Nodeテスト
npm run typecheck
npm test
npm run ios:dev             # APIとSimulatorアプリをまとめて起動
npm run ios:run             # 起動済みAPIを使ってSimulatorアプリだけ再起動
npm run ios:test
npm run contract:generate
npm run catalog:generate
```

OpenAPIを変更した場合は `npm run contract:generate` を実行し、生成されたTypeScript型も同時にコミットします。Name Suggestion Indexを更新した場合は `npm run catalog:generate` でチェーンカタログを再生成します。

## API

- `GET /api/chains?q=`: 日本向けチェーン候補
- `GET /api/geocode?q=`: 地名・住所候補
- `POST /api/search`: 半径1〜40kmの同一施設または徒歩圏検索
- `POST /api/route`: 選択した徒歩候補の経路GeoJSON

公開契約の正本は `packages/api-contract/Sources/ShopOverlapAPI/openapi.yaml` です。座標はAPI上では常に `[longitude, latitude]` の順序です。Google Places/RoutesはiOSから直接呼ばず、Workerを経由します。

## Cloudflareへのデプロイ

初回にWorker secretを登録します。

```bash
npx wrangler secret put GOOGLE_MAPS_API_KEY --config apps/api/wrangler.toml
```

`npm run api:deploy` はAPI Workerだけをデプロイします。GitHub Actionsからデプロイする場合はRepository secretsに `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録します。

Places APIの結果はGoogle Map上に表示し、SDKが表示するGoogle Mapsの帰属を隠しません。APIが第三者帰属を返した場合は結果付近にも表示します。
