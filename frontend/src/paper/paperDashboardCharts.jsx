const VIEW_WIDTH = 720;

function points(values, height, yMax) {
  const last = values.length - 1;
  return values.map((value, index) => [
    (index / last) * VIEW_WIDTH,
    height - Math.min(value / yMax, 1) * height,
  ]);
}

function line(pairs) {
  return pairs
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
}

function area(pairs, height) {
  const first = pairs[0][0].toFixed(2);
  const last = pairs[pairs.length - 1][0].toFixed(2);
  return `${line(pairs)} L${last} ${height} L${first} ${height} Z`;
}

function GridLines({ height, rows = 4 }) {
  return Array.from({ length: rows + 1 }, (_, index) => {
    const y = (index / rows) * height;
    return (
      <line
        key={index}
        x1="0"
        x2={VIEW_WIDTH}
        y1={y}
        y2={y}
        stroke="var(--pd-border)"
        strokeWidth={index === rows ? 1.2 : 0.8}
        strokeDasharray={index === rows ? undefined : "3 4"}
      />
    );
  });
}

function HourAxis() {
  return (
    <div className="pd-num mt-1.5 flex justify-between text-[10px] text-[var(--pd-muted-foreground)]">
      {["00", "06", "12", "18", "24"].map((hour) => (
        <span key={hour}>{hour}</span>
      ))}
    </div>
  );
}

function YAxis({ yMax, unit, rows = 4 }) {
  return (
    <div
      className="pd-num flex flex-col justify-between pr-2 text-right text-[10px] text-[var(--pd-muted-foreground)]"
      style={{ height: 176 }}
    >
      {Array.from({ length: rows + 1 }, (_, index) => (
        <span key={index}>
          {((yMax * (rows - index)) / rows).toFixed(yMax < 10 ? 1 : 0)}
          {index === 0 ? ` ${unit}` : ""}
        </span>
      ))}
    </div>
  );
}

/** Demand and generation on one shared axis: the size gap is the finding, not a defect. */
export function LoadProfileChart({ demandKw, generationKw, yMax, unit = "kW" }) {
  const height = 176;
  const demandPoints = points(demandKw, height, yMax);
  const generationPoints = generationKw ? points(generationKw, height, yMax) : null;
  return (
    <div className="flex">
      <YAxis yMax={yMax} unit={unit} />
      <div className="min-w-0 flex-1">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
          className="h-[176px] w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label="15분 단위 부하 프로파일"
        >
          <GridLines height={height} />
          <path d={area(demandPoints, height)} fill="var(--pd-demand-soft)" />
          <path
            d={line(demandPoints)}
            fill="none"
            stroke="var(--pd-demand)"
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
          />
          {generationPoints ? (
            <>
              <path d={area(generationPoints, height)} fill="var(--pd-solar-soft)" />
              <path
                d={line(generationPoints)}
                fill="none"
                stroke="var(--pd-solar)"
                strokeWidth="1.6"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : null}
        </svg>
        <HourAxis />
      </div>
    </div>
  );
}

/** Generation only, on its own axis. The axis label states the scale explicitly. */
export function GenerationChart({ generationKw, yMax }) {
  const height = 96;
  const pairs = points(generationKw, height, yMax);
  return (
    <div>
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
        className="h-24 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="태양광 발전 프로파일 (확대 축)"
      >
        <GridLines height={height} rows={2} />
        <path d={area(pairs, height)} fill="var(--pd-solar-soft)" />
        <path
          d={line(pairs)}
          fill="none"
          stroke="var(--pd-solar)"
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <HourAxis />
    </div>
  );
}

export function ShareBar({ selfKwh, gridKwh }) {
  const total = selfKwh + gridKwh;
  const selfPercent = total > 0 ? (selfKwh / total) * 100 : 0;
  return (
    <div>
      <div className="flex h-7 w-full overflow-hidden rounded-md border border-[var(--pd-border)]">
        <div
          className="flex items-center justify-center bg-[var(--pd-solar)]"
          style={{ width: `${Math.max(selfPercent, 1.6)}%` }}
        />
        <div className="flex-1 bg-[var(--pd-muted)]" />
      </div>
      <div className="pd-num mt-2 flex justify-between text-[11px] text-[var(--pd-muted-foreground)]">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-[2px] bg-[var(--pd-solar)] align-middle" />
          자가소비 {selfKwh.toFixed(2)} kWh ({selfPercent.toFixed(2)}%)
        </span>
        <span>
          계통수전 {gridKwh.toFixed(2)} kWh ({(100 - selfPercent).toFixed(2)}%)
          <span className="ml-1 inline-block h-2 w-2 rounded-[2px] bg-[var(--pd-grid)] align-middle" />
        </span>
      </div>
    </div>
  );
}
