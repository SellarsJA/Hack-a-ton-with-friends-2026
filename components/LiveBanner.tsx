export default function LiveBanner({ ageSeconds }: { ageSeconds: number | null }) {
  let text: string | null = null
  if (ageSeconds === null) text = 'Live data unavailable. Showing scheduled times.'
  else if (ageSeconds > 120) text = `Live data is ${Math.round(ageSeconds / 60)} min old.`
  if (!text) return null
  return (
    <p role="status" className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
      {text}
    </p>
  )
}
