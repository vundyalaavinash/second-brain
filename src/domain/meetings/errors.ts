/** A meeting or recording failure the API can answer with, carrying its own status. */
export class MeetingError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "MeetingError";
  }
}
