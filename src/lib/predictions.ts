import type { DB } from "@/db/client";
import { localDay } from "@/domain/activity";
import { duePredictions, listPredictions, predictionScores, type PredictionFilter } from "@/domain/predictions";
import { serializePrediction } from "@/lib/api";
import type { PredictionsDTO } from "@/lib/dto";

/**
 * The log in one payload: the rows a filter asked for, the three scores, and what is overdue.
 *
 * The scores deliberately ignore the filter. Narrowing the view to one kind or to the open rows
 * is a way of reading the log; if the figures moved with it, clicking "resolved" would show a
 * calibration of 100% and read as progress rather than as a filter.
 */
export function predictionsPayload(db: DB, filter: PredictionFilter, now: Date): PredictionsDTO {
  const today = localDay(now.toISOString());
  return {
    predictions: listPredictions(db, filter).map(serializePrediction),
    scores: predictionScores(db),
    due: duePredictions(db, today).map(serializePrediction),
    today,
  };
}
