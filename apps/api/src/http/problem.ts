import type { ApiProblem } from "@shop-overlap/api-contract";

export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpProblem";
  }
}

export function problemResponse(problem: HttpProblem, headers: HeadersInit): Response {
  const body: ApiProblem = {
    error: {
      code: problem.code,
      message: problem.message,
      retryable: problem.retryable,
      ...(problem.details === undefined ? {} : { details: problem.details }),
    },
  };
  return Response.json(body, { status: problem.status, headers });
}

export function asProblem(error: unknown): HttpProblem {
  if (error instanceof HttpProblem) return error;
  console.error("Unhandled Worker error", error);
  return new HttpProblem(
    500,
    "INTERNAL_ERROR",
    "予期しないエラーが発生しました。時間をおいて再度お試しください。",
    true,
  );
}
