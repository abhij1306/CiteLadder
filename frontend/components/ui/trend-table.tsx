import type { TrendEvent, TrendPoint } from '@/components/ui/trend-chart';

/** Every value, and every drawn marker, for a reader who cannot see the plot. */
export function TrendTable({
  label,
  data,
  lines,
  events,
  shown,
}: Readonly<{
  label: string;
  data: readonly TrendPoint[];
  lines: readonly Readonly<{ name: string; values: readonly (number | null)[] }>[];
  events: readonly TrendEvent[];
  shown: (value: number | null | undefined) => string;
}>) {
  const notes = [
    ...data.flatMap((point) =>
      point.versionChange ? [`Method changed at ${point.label}: ${point.versionChange.note}`] : [],
    ),
    ...events.map((event) => event.label),
  ];
  return (
    <div className="sr-only">
      <table>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Series</th>
            {data.map((point, index) => (
              <th key={`${point.label}-${index}`} scope="col">
                {point.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.name}>
              <th scope="row">{line.name}</th>
              {data.map((point, index) => (
                <td key={`${point.label}-${index}`}>{shown(line.values[index])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {notes.length ? (
        <ul aria-label={`${label}: marked`}>
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
