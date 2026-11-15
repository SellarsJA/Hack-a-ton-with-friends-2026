export default function Slider({
  name,
  label,
  value,
  onChange,
}: {
  name: string
  label: string
  value: number | undefined
  onChange: (v: number | undefined) => void
}) {
  const id = `slider-${name}`
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={1}
        max={5}
        step={1}
        value={value ?? 3}
        aria-valuetext={value === undefined ? 'Not rated' : `${value} of 5`}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => {
          // Tapping the untouched default (3) fires no change event, so record it here.
          if (value === undefined) onChange(Number((e.target as HTMLInputElement).value))
        }}
        className="feedback-range w-full"
      />
      <div className="flex justify-between text-xs text-zinc-600 dark:text-zinc-400">
        <span>1 = Way off</span>
        <span>5 = Spot on</span>
      </div>
      <div className="flex min-h-11 items-center justify-between text-sm">
        <span>{value === undefined ? 'Not rated' : `${value} of 5`}</span>
        <button
          type="button"
          aria-label={`Clear ${label}`}
          disabled={value === undefined}
          onClick={() => onChange(undefined)}
          className="min-h-11 px-3 text-blue-700 underline disabled:opacity-40 dark:text-blue-300"
        >
          Clear
        </button>
      </div>
    </div>
  )
}
