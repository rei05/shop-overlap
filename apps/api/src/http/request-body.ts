import { HttpProblem } from "./problem";

const MAX_BODY_BYTES = 64 * 1024;

export async function requestJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length") || "0");
  if (length > MAX_BODY_BYTES) {
    throw new HttpProblem(413, "REQUEST_TOO_LARGE", "リクエストが大きすぎます。", false);
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new HttpProblem(400, "INVALID_JSON", "JSONを読み取れませんでした。");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new HttpProblem(413, "REQUEST_TOO_LARGE", "リクエストが大きすぎます。", false);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpProblem(400, "INVALID_JSON", "正しいJSONを送信してください。");
  }
}
