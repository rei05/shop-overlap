import { expect, test, type Page } from "@playwright/test";

type SearchPayload = {
  center: [number, number];
  radiusMeters: number;
  mode: string;
  maxWalkMinutes?: number;
  chains: Array<{ name: string }>;
};

const capturedSearchRequests = new WeakMap<Page, SearchPayload[]>();

const facilityResult = {
  mode: "facility",
  analyzedAt: "2026-08-01T00:00:00.000Z",
  notices: [],
  missingChains: [],
  results: [{
    kind: "facility",
    id: "mall-tokyo",
    name: "東京まちあわせモール",
    subtitle: "八重洲",
    coordinate: [139.768, 35.6815],
    stores: [
      { id: "starbucks-1", chainId: "starbucks", chainName: "スターバックス", name: "スターバックス 東京店", coordinate: [139.768, 35.6815], address: "東京都千代田区丸の内１丁目" },
      { id: "muji-1", chainId: "muji", chainName: "無印良品", name: "無印良品 東京店", coordinate: [139.7681, 35.6816], address: "東京都千代田区丸の内１丁目" },
    ],
  }],
};

const walkingResult = {
  mode: "walking",
  analyzedAt: "2026-08-01T00:00:00.000Z",
  notices: ["徒歩時間は目安です。"],
  missingChains: [],
  results: [{
    kind: "walking",
    id: "walk-tokyo",
    name: "徒歩圏の店舗",
    coordinate: [139.768, 35.6815],
    durationSeconds: 840,
    estimatedDistanceMeters: 960,
    stores: facilityResult.results[0].stores,
  }],
};

const routeResult = {
  route: {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[139.768, 35.6815], [139.7681, 35.6816]] },
    }],
  },
  distanceMeters: 960,
  durationSeconds: 840,
};

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) };
}

async function mockExternalServices(page: Page) {
  let routeRequests = 0;
  const searchRequests: SearchPayload[] = [];
  capturedSearchRequests.set(page, searchRequests);
  const apiHosts = ["http://api.test.local", "http://localhost:8787"];

  await page.route("https://maps.googleapis.com/**", (route) => route.abort());

  for (const host of apiHosts) {
    await page.route(`${host}/api/config`, (route) => route.fulfill(json({ googleMapsBrowserApiKey: "test-browser-key", googleMapsMapId: "test-map-id" })));
    await page.route(`${host}/api/chains**`, (route) => {
      const query = new URL(route.request().url()).searchParams.get("q") ?? "";
      const options = query.includes("無印")
        ? [{ id: "muji", name: "無印良品", aliases: ["MUJI"], category: "雑貨" }]
        : [{ id: "starbucks", name: "スターバックス", wikidata: "Q37158", aliases: ["Starbucks"], category: "カフェ" }];
      return route.fulfill(json(options));
    });
    await page.route(`${host}/api/geocode**`, (route) => route.fulfill(json([
      { id: "tokyo-station", label: "東京駅", locality: "東京都千代田区", coordinate: [139.7671, 35.6812] },
    ])));
    await page.route(`${host}/api/search`, async (route) => {
      const request = route.request().postDataJSON() as SearchPayload;
      searchRequests.push(request);
      if (request.chains.some((chain) => chain.name === "API障害テスト")) {
        await route.fulfill(json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "外部APIが一時的に利用できません。", retryable: true } }, 503));
        return;
      }
      await route.fulfill(json(request.mode === "walking" ? walkingResult : facilityResult));
    });
    await page.route(`${host}/api/route`, async (route) => {
      routeRequests += 1;
      await route.fulfill(json(routeResult));
    });
  }

  return { routeRequests: () => routeRequests };
}

async function selectTwoChainsAndLocation(page: Page) {
  await page.getByLabel("スターバックスを削除").click();
  await page.getByLabel("無印良品を削除").click();

  const chainInput = page.getByLabel("チェーン名を追加");
  await chainInput.fill("スタバ");
  await page.getByRole("option", { name: /スターバックス/ }).click();
  await chainInput.fill("無印");
  await page.getByRole("option", { name: /無印良品/ }).click();
  await expect(page.getByLabel("選択中のチェーン")).toContainText("スターバックス");
  await expect(page.getByLabel("選択中のチェーン")).toContainText("無印良品");

  await page.getByLabel("検索地点").fill("東京駅");
  await page.getByRole("option", { name: /東京駅/ }).click();
}

test.beforeEach(async ({ page }) => {
  await mockExternalServices(page);
});

test("入力候補はEscapeキーやフォーカス移動で閉じる", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("スターバックスを削除").click();
  const chainInput = page.getByLabel("チェーン名を追加");
  const chainOption = page.getByRole("option", { name: /スターバックス/ });
  const chainSuggestions = page.locator("#chain-suggestions");
  await chainInput.fill("スタバ");
  await expect(chainOption).toBeVisible();
  await chainInput.press("Escape");
  await expect(chainSuggestions).toBeHidden();
  await page.locator(".app-header").click();
  await chainInput.focus();
  await expect(chainOption).toBeVisible();
  await page.locator(".app-header").click();
  await expect(chainSuggestions).toBeHidden();

  const locationInput = page.getByLabel("検索地点");
  const placeOption = page.getByRole("option", { name: /東京駅/ });
  const placeSuggestions = page.locator("#place-suggestions");
  await locationInput.fill("東京駅");
  await expect(placeOption).toBeVisible();
  await locationInput.press("Escape");
  await expect(placeSuggestions).toBeHidden();
  await page.locator(".app-header").click();
  await locationInput.focus();
  await expect(placeOption).toBeVisible();
  await page.locator(".app-header").click();
  await expect(placeSuggestions).toBeHidden();
});

test("チェーン候補を矢印キー、Enter、Escapeで操作できる", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("スターバックスを削除").click();
  const chainInput = page.getByLabel("チェーン名を追加");
  await chainInput.fill("スタバ");
  const catalogOption = page.getByRole("option", { name: /スターバックス/ });
  const freeOption = page.getByRole("option", { name: /「スタバ」を追加/ });
  await expect(catalogOption).toBeVisible();
  await expect(chainInput).toHaveAttribute("aria-expanded", "true");

  await chainInput.press("ArrowDown");
  await expect(catalogOption).toBeFocused();
  await catalogOption.press("ArrowDown");
  await expect(freeOption).toBeFocused();
  await freeOption.press("ArrowUp");
  await expect(catalogOption).toBeFocused();
  await catalogOption.press("Escape");
  await expect(chainInput).toBeFocused();
  await expect(page.locator("#chain-suggestions")).toBeHidden();
  await expect(chainInput).toHaveAttribute("aria-expanded", "false");

  await page.locator(".app-header").click();
  await chainInput.focus();
  await expect(catalogOption).toBeVisible();
  await chainInput.press("ArrowDown");
  await expect(catalogOption).toBeFocused();
  await catalogOption.press("Enter");
  await expect(page.getByLabel("選択中のチェーン")).toContainText("スターバックス");
  await expect(chainInput).toBeFocused();

  await chainInput.fill("ローカル店");
  const localFreeOption = page.getByRole("option", { name: /「ローカル店」を追加/ });
  await expect(localFreeOption).toBeVisible();
  await chainInput.press("ArrowDown");
  await expect(localFreeOption).toBeFocused();
  await localFreeOption.press("Enter");
  await expect(page.getByLabel("選択中のチェーン")).toContainText("ローカル店");
});

test("場所と2チェーンを選び、共通施設を検索できる", async ({ page }) => {
  await page.goto("/");
  await selectTwoChainsAndLocation(page);
  await page.getByRole("button", { name: "この条件で探す" }).click();

  await expect(page.getByText("1件見つかりました")).toBeVisible();
  await expect(page.getByTestId("result-card").filter({ hasText: "東京まちあわせモール" })).toBeVisible();
  await expect(page.getByText("共通の施設")).toBeVisible();
});

test("検索結果を表示しても地図の縮尺を変更しない", async ({ page }) => {
  test.skip(true, "Google Maps SDKを使用する地図操作は実キーを用いるスモークテストで検証します。");
  await page.goto("/");
  await selectTwoChainsAndLocation(page);
  const scale = page.locator(".gm-style .gm-style-cc").first();
  await expect(scale).toBeVisible();
  await page.waitForTimeout(650);
  const scaleBeforeSearch = await scale.textContent();

  await page.getByRole("button", { name: "この条件で探す" }).click();
  await expect(page.getByText("1件見つかりました")).toBeVisible();
  await page.waitForTimeout(650);

  expect(await scale.textContent()).toBe(scaleBeforeSearch);
});

test("結果一覧または数字ピンをユーザーが選んだ時だけ、その結果へズームする", async ({ page }, testInfo) => {
  test.skip(true, "Google Maps SDKを使用する地図操作は実キーを用いるスモークテストで検証します。");
  test.skip(testInfo.project.name !== "chromium", "Map marker interaction is covered on desktop Chromium.");
  await page.goto("/");
  await selectTwoChainsAndLocation(page);
  const scale = page.locator(".gm-style .gm-style-cc").first();
  await expect(scale).toBeVisible();
  await page.waitForTimeout(650);
  const scaleBeforeSearch = await scale.textContent();

  await page.getByRole("button", { name: "この条件で探す" }).click();
  const card = page.getByTestId("result-card");
  await expect(card).toBeVisible();
  await page.waitForTimeout(650);
  expect(await scale.textContent()).toBe(scaleBeforeSearch);

  await card.click();
  await expect.poll(async () => scale.textContent()).not.toBe(scaleBeforeSearch);

  await page.locator(".map-marker[data-marker-kind='result']").click();
  await expect(scale).toBeVisible();
});

test("結果ピンは数字、選択中店舗ピンはアルファベットで表示する", async ({ page }) => {
  test.skip(true, "Google Maps SDKを使用する地図操作は実キーを用いるスモークテストで検証します。");
  await page.goto("/");
  await selectTwoChainsAndLocation(page);
  await page.getByRole("radio", { name: /徒歩圏/ }).click();
  await page.getByRole("button", { name: "この条件で探す" }).click();

  await expect(page.locator(".map-marker[data-marker-kind='result']")).toHaveText("1");
  await expect(page.locator(".store-marker[data-marker-kind='store']")).toHaveText(["A", "B"]);
});

test("地図操作後も現在地ボタンは地図を現在地へ移動し、結果を維持する", async ({ page }, testInfo) => {
  test.skip(true, "Google Maps SDKを使用する地図操作は実キーを用いるスモークテストで検証します。");
  test.skip(testInfo.project.name !== "chromium", "Map camera behavior is covered on desktop Chromium.");
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ longitude: 139.9, latitude: 35.7 });
  await page.goto("/");
  await selectTwoChainsAndLocation(page);
  await page.getByRole("button", { name: "この条件で探す" }).click();
  const card = page.getByTestId("result-card");
  await expect(card).toBeVisible();

  const canvas = page.locator(".map-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("地図の表示領域を取得できませんでした。");
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.35);

  await page.getByLabel("現在地を使う").click();
  await expect(page.getByLabel("検索地点")).toHaveValue("現在地");
  await expect(card).toBeVisible();
  await expect.poll(async () => page.getByLabel("検索結果の地図").getAttribute("data-map-camera-center"))
    .toBe("139.90000,35.70000");
});

test("地図に検索中心ピン、半径円の案内、縮尺を表示する", async ({ page }) => {
  test.skip(true, "Google Maps SDKを使用する地図表示は実キーを用いるスモークテストで検証します。");
  await page.goto("/");

  await expect(page.getByRole("button", { name: "検索範囲の中心。ドラッグして移動できます" })).toBeVisible();
  await expect(page.locator(".gm-style .gm-style-cc").first()).toBeVisible();
  await expect(page.getByLabel("検索結果の地図")).toHaveAttribute("data-map-provider", "google");
  await expect(page.getByLabel("検索結果の地図")).toHaveAttribute("data-search-radius-meters", "20000");
  await expect(page.getByText("円内が検索範囲 · クリックまたはピンのドラッグで中心を変更")).toBeVisible();
});

test("中心ピンと選択した検索半径を検索条件として送る", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("地図をクリックするかピンをドラッグして中心を決め、半径20kmを検索します。", { exact: true })).toBeVisible();
  const radius = page.getByTestId("search-radius");
  await expect(radius).toHaveValue("20");
  await radius.fill("15");
  await expect(radius).toHaveValue("15");
  await expect(page.getByText("地図をクリックするかピンをドラッグして中心を決め、半径15kmを検索します。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("検索結果の地図")).toHaveAttribute("data-search-radius-meters", "15000");
  await selectTwoChainsAndLocation(page);
  await page.getByRole("button", { name: "この条件で探す" }).click();
  const requests = capturedSearchRequests.get(page)!;
  await expect.poll(() => requests.length).toBe(1);

  const request = requests[0];
  expect(request.center).toEqual([139.7671, 35.6812]);
  expect(request.radiusMeters).toBe(15_000);
  expect((request as { bounds?: unknown }).bounds).toBeUndefined();
});

test("地図をクリックして検索中心を変更する", async ({ page }, testInfo) => {
  test.skip(true, "Google Maps SDKを使用する地図操作は実キーを用いるスモークテストで検証します。");
  test.skip(testInfo.project.name !== "chromium", "Map click is covered on desktop Chromium.");
  await page.goto("/");
  await selectTwoChainsAndLocation(page);
  const requests = capturedSearchRequests.get(page)!;
  await page.getByRole("button", { name: "この条件で探す" }).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.getByText("1件見つかりました")).toBeVisible();
  const firstCenter = requests[0].center;

  const map = page.locator(".map-canvas");
  const box = await map.boundingBox();
  if (!box) throw new Error("地図の表示領域を取得できませんでした。");
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.35);
  await page.waitForTimeout(300);
  await expect(page.getByTestId("result-card").filter({ hasText: "東京まちあわせモール" })).toBeVisible();

  await page.getByRole("button", { name: "この条件で探す" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].center[0]).not.toBeCloseTo(firstCenter[0], 7);
  expect(requests[1].center[1]).not.toBeCloseTo(firstCenter[1], 7);
  expect(requests[1].radiusMeters).toBe(20_000);
});

test("検索結果は検索半径を変えても維持する", async ({ page }) => {
  await page.goto("/");
  await selectTwoChainsAndLocation(page);
  await page.getByRole("button", { name: "この条件で探す" }).click();
  const result = page.getByTestId("result-card").filter({ hasText: "東京まちあわせモール" });
  await expect(result).toBeVisible();

  await page.getByTestId("search-radius").fill("15");

  await expect(result).toBeVisible();
  await expect(page.getByLabel("検索結果の地図")).toHaveAttribute("data-search-radius-meters", "15000");
});

test("徒歩圏モードでは巡回結果と経路を取得する", async ({ page }) => {
  await page.goto("/");
  await selectTwoChainsAndLocation(page);
  await page.getByRole("radio", { name: /徒歩圏/ }).click();
  await expect(page.getByText("店舗を回る上限")).toBeVisible();
  const walkMinutes = page.getByTestId("walk-minutes");
  await expect(walkMinutes).toHaveAttribute("min", "5");
  await expect(walkMinutes).toHaveAttribute("max", "15");
  await expect(walkMinutes).toHaveAttribute("step", "5");
  await expect(walkMinutes).toHaveValue("10");
  const routeRequest = page.waitForRequest((request) => request.url().endsWith("/api/route"));
  await page.getByRole("button", { name: "この条件で探す" }).click();

  await expect(page.getByText("徒歩で回る順")).toBeVisible();
  const resultCard = page.getByTestId("result-card");
  await expect(resultCard.locator("strong")).toHaveText(/^(?:東京都|千代田区|丸の内)$/);
  await expect(resultCard).not.toContainText("徒歩ルート 1");
  const requests = capturedSearchRequests.get(page)!;
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].maxWalkMinutes).toBe(10);
  await routeRequest;
});

test("外部APIのエラーを利用者に表示する", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("スターバックスを削除").click();
  await page.getByLabel("無印良品を削除").click();
  const chainInput = page.getByLabel("チェーン名を追加");
  await chainInput.fill("API障害テスト");
  await page.getByRole("option", { name: /API障害テスト.*追加/ }).click();
  await chainInput.fill("無印");
  await page.getByRole("option", { name: /無印良品/ }).click();
  await page.getByRole("button", { name: "この条件で探す" }).click();

  await expect(page.locator(".error-message")).toContainText("外部APIが一時的に利用できません");
});

test("モバイルでも検索フォームと結果を操作できる", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobile layout is covered by the mobile project.");
  await page.goto("/");
  await expect(page.getByLabel("検索結果の地図")).toBeVisible();
  await selectTwoChainsAndLocation(page);
  await page.getByRole("button", { name: "この条件で探す" }).click();
  await expect(page.getByTestId("result-card").filter({ hasText: "東京まちあわせモール" })).toBeVisible();
});
