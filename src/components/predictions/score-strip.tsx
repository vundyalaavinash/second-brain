"use client";

import { CircleHelp, Dices, Ruler } from "lucide-react";
import type { PredictionScoresDTO } from "@/lib/dto";
import { BRIER_TARGET, CALIBRATION_TARGET, HIT_RATE_TARGET } from "@/domain/predictions/score";

/**
 * The three figures the log exists to move, on one line.
 *
 * A score that does not exist yet is said as "not yet" rather than as a number: a fresh log
 * reading "0%" would say you are bad at estimating when it only means nothing has resolved. Each
 * figure names its own target in its title, since the target is what makes the number mean
 * anything, and off-target reads as a colour rather than as a warning icon — these are
 * instruments, not alerts.
 */
export function ScoreStrip({ scores }: { scores: PredictionScoresDTO }) {
  const calibration = scores.estimate.percent;
  const brier = scores.risk.score;
  const calls = scores.call.percent;

  return (
    <div role="group" aria-label="Calibration" className="flex items-center gap-4 flex-wrap text-[12px] text-fg-muted">
      <Figure
        icon={Ruler}
        title={`${scores.estimate.resolved} of ${scores.estimate.logged} estimates resolved; ${scores.estimate.inRange} landed inside the 90% range. Target ${CALIBRATION_TARGET}%.`}
        off={calibration !== null && calibration < CALIBRATION_TARGET}
      >
        {calibration === null ? "Calibration not yet" : `${calibration}% in range`}
      </Figure>

      <Figure
        icon={Dices}
        title={`Brier over ${scores.risk.resolved} of ${scores.risk.logged} risk calls. Lower is better; 0.25 is a coin flip, target under ${BRIER_TARGET}.`}
        off={brier !== null && brier > BRIER_TARGET}
      >
        {brier === null ? "Brier not yet" : `Brier ${brier.toFixed(2)}`}
      </Figure>

      <Figure
        icon={CircleHelp}
        title={`${scores.call.hit} of ${scores.call.resolved} calls right, ${scores.call.logged} logged. Target ${HIT_RATE_TARGET}%.`}
        off={calls !== null && calls < HIT_RATE_TARGET}
      >
        {calls === null ? "Calls not yet" : `${calls}% right`}
      </Figure>
    </div>
  );
}

function Figure({
  icon: Icon,
  title,
  off,
  children,
}: {
  icon: typeof Ruler;
  title: string;
  off: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`flex items-center gap-1 ${off ? "text-warn" : ""}`} title={title}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
      {children}
    </span>
  );
}
