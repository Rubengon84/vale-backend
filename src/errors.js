export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`, "not_found");
export const forbidden = (message) => new HttpError(403, message, "forbidden");
export const conflict = (message, code) => new HttpError(409, message, code);
