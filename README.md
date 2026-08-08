# まとめて寄れる店検索

指定した2〜5件のチェーンが同じ商業施設に入っている場所、または設定時間内に徒歩で回れる組み合わせを探す、日本国内向けのWeb/iOSアプリです。店舗・施設検索と徒歩経路はGoogle Maps Platformを利用し、APIキーを保持するCloudflare WorkerをWebとiOSで共有します。

## リポジトリ構成

```text
apps/
  web/                 Next.js静的Webアプリ
  api/                 Cloudflare Worker API
  ios/                 SwiftUI iOSアプリ
packages/
  api-contract/        OpenAPI、生成TypeScript型、Swift OpenAPI package
  shared-ts/           Web/Worker共通の純粋TypeScriptロジック
  chain-catalog/       日本向けチェーンカタログ
tooling/scripts/       カタログなどの生成スクリプト
e2e/web/               Web E2Eテスト
```

Node側はnpm workspacesです。iOSはXcodeプロジェクトから `packages/api-contract` をローカルSwift Packageとして参照します。

## Google Cloudの準備

課金を有効にしたGoogle Cloudプロジェクトで次を有効化します。

- Maps JavaScript API
- Maps SDK for iOS
- Places API (New)
- Routes API

用途別に3つのキーを作成してください。

- サーバー用: Places API (New) とRoutes APIだけを許可し、Worker secret `GOOGLE_MAPS_API_KEY` に登録
- Web用: Maps JavaScript APIだけを許可し、公開URLとローカルURLでHTTPリファラー制限
- iOS用: Maps SDK for iOSだけを許可し、Bundle ID `jp.shopoverlap.app`（変更する場合は設定も同期）でアプリ制限

Web用・iOS用キーはクライアントへ配布されるため、制限なしのサーバー用キーと共用しません。Google CloudでWeb用のMap IDも作成します。

## Web/APIのローカル起動

Node.js 22以降を用意します。

```bash
npm install
test -f apps/api/.dev.vars || cp apps/api/.dev.vars.example apps/api/.dev.vars
test -f apps/web/.env.local || cp apps/web/.env.example apps/web/.env.local
```

`apps/api/.dev.vars` にサーバー用キー、Web用キー、Map IDを設定します。次の2コマンドを別ターミナルで実行します。

```bash
npm run dev:api
npm run dev:web
```

Webは `http://localhost:3000`、静的Webを含むWorkerは `http://localhost:8787` で確認できます。

## iOSのローカル起動

Xcode 26以降を用意し、次の設定ファイルを作成します。

```bash
cp apps/ios/Config/Secrets.xcconfig.example apps/ios/Config/Secrets.xcconfig
```

`Secrets.xcconfig` にBundle ID制限済みのiOS用キーを指定します。DebugのAPI URLは既定で `http://127.0.0.1:8787` なので、先に `npm run dev:api` を起動してから `apps/ios/ShopOverlap.xcodeproj` の `ShopOverlap` schemeを実行します。Releaseでは同ファイルまたはCI設定から本番WorkerのHTTPS URLを渡します。

## 開発コマンド

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run test:ios
npm run contracts:check
npm run catalog:generate
```

OpenAPIを変更した場合は `npm run contracts:generate` を実行し、生成されたTypeScript型も同時にコミットします。Name Suggestion Indexを更新した場合は `npm run catalog:generate` で `packages/chain-catalog/data/chains.jp.json` を再生成します。

## API

- `GET /api/config`: Web用Google Maps設定
- `GET /api/chains?q=`: 日本向けチェーン候補
- `GET /api/geocode?q=`: 地名・住所候補
- `POST /api/search`: 半径1〜40kmの同一施設または徒歩圏検索
- `POST /api/route`: 選択した徒歩候補の経路GeoJSON

公開契約の正本は `packages/api-contract/Sources/ShopOverlapAPI/openapi.yaml` です。座標はAPI上では常に `[longitude, latitude]` の順序です。Google Places/RoutesはiOSから直接呼ばず、サーバー用キーを保持するWorkerを経由します。

## Cloudflareへのデプロイ

初回にWorker secretを登録します。

```bash
npx wrangler secret put GOOGLE_MAPS_API_KEY --config apps/api/wrangler.toml
npx wrangler secret put GOOGLE_MAPS_BROWSER_API_KEY --config apps/api/wrangler.toml
npx wrangler secret put GOOGLE_MAPS_MAP_ID --config apps/api/wrangler.toml
```

`npm run deploy` はWebを静的出力し、その成果物とAPIを1つのWorkerへデプロイします。GitHub Actionsからデプロイする場合はRepository secretsに `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録します。

## 規約と帰属

Places APIの結果はGoogle Map上に表示し、SDKが表示するGoogle Mapsの帰属を隠しません。APIが第三者帰属を返した場合は結果付近にも表示します。公開前に `/terms/` と `/privacy/` を運営実態に合わせて更新し、iOSからも同じ公開ページへリンクします。
